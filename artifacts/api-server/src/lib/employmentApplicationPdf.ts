import PDFDocument from "pdfkit";
import type { JobApplication } from "@workspace/db/schema";

type FieldLine = { label: string; value: string };

const PAGE_BOTTOM = 735;
const MAX_FIELD_LINES = 500;
const MAX_FIELD_VALUE_LENGTH = 20_000;

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (first) => first.toUpperCase());
}

function scalarText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    if (!value.every((item) =>
      item === null || item === undefined ||
      ["string", "number", "bigint", "boolean"].includes(typeof item))) return null;
    const parts = value.map(scalarText).filter((part): part is string => part !== null);
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

function fieldLines(value: unknown, prefix = "", depth = 0): FieldLine[] {
  if (value === null || value === undefined) return [];
  if (depth > 5) throw new Error("APPLICATION_PDF_TOO_LARGE");
  const scalar = scalarText(value);
  if (scalar !== null) {
    if (scalar.length > MAX_FIELD_VALUE_LENGTH) throw new Error("APPLICATION_PDF_TOO_LARGE");
    return [{ label: prefix || "Details", value: scalar }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((child, index) =>
      fieldLines(child, prefix ? `${prefix} / Entry ${index + 1}` : `Entry ${index + 1}`, depth + 1),
    );
  }
  if (typeof value !== "object") return [];

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    fieldLines(child, prefix ? `${prefix} / ${humanize(key)}` : humanize(key), depth + 1),
  );
}

function cleanPdfText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function drawPageHeader(document: PDFKit.PDFDocument) {
  const width = document.page.width;
  document.save();
  document.rect(0, 0, width, 72).fill("#064e3b");
  document.fillColor("#ffffff").font("Helvetica-Bold").fontSize(17)
    .text("Marvol Employment Application", 54, 26, { width: width - 108 });
  document.fillColor("#d1fae5").font("Helvetica").fontSize(8)
    .text("CONFIDENTIAL — ADMINISTRATOR REVIEW", 54, 51, { width: width - 108 });
  document.restore();
  document.y = 89;
}

export async function createEmploymentApplicationPdf(application: JobApplication): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({
      size: "LETTER",
      margin: 54,
      info: {
        Title: "Marvol Employment Application",
        Author: "Marvol Enterprises",
        Subject: "Confidential application record",
      },
    });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Uint8Array) => chunks.push(Buffer.from(chunk)));
    document.once("error", reject);
    document.once("end", () => resolve(Buffer.concat(chunks)));

    drawPageHeader(document);
    document.fillColor("#0f172a").font("Helvetica-Bold").fontSize(15)
      .text(`${application.firstName} ${application.lastName}`);
    document.moveDown(0.3);
    document.fillColor("#475569").font("Helvetica").fontSize(9);
    const summary = [
      application.positionApplied ? `Position: ${application.positionApplied}` : null,
      application.email ? `Email: ${application.email}` : null,
      application.phone ? `Phone: ${application.phone}` : null,
      `Status: ${humanize(application.status)}`,
      `Submitted: ${new Date(application.createdAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC`,
    ].filter((line): line is string => Boolean(line));
    document.text(summary.map(cleanPdfText).join("  ·  "), {
      width: document.page.width - document.page.margins.left - document.page.margins.right,
    });
    document.moveDown(0.6);

    const groups: Array<[string, unknown]> = [
      ["Job application", application.application],
      ["Form I-9 — Employee section", application.i9Employee],
      ["Form W-4 — Employee section", application.w4Employee],
      ["Form I-9 — Employer section", application.i9Employer],
      ["Form W-4 — Employer section", application.w4Employer],
    ];

    let lineCount = 0;
    const contentWidth = document.page.width - document.page.margins.left - document.page.margins.right;
    for (const [sectionTitle, fields] of groups) {
      const lines = fieldLines(fields);
      if (!lines.length) continue;
      if (++lineCount > MAX_FIELD_LINES) throw new Error("APPLICATION_PDF_TOO_LARGE");

      if (document.y + 28 > PAGE_BOTTOM) {
        document.addPage();
        drawPageHeader(document);
      }
      document.fillColor("#065f46").font("Helvetica-Bold").fontSize(11)
        .text(sectionTitle, { width: contentWidth });
      document.moveDown(0.25);
      document.strokeColor("#a7f3d0").lineWidth(1)
        .moveTo(document.page.margins.left, document.y)
        .lineTo(document.page.width - document.page.margins.right, document.y)
        .stroke();
      document.moveDown(0.4);

      for (const line of lines) {
        lineCount++;
        if (lineCount > MAX_FIELD_LINES) throw new Error("APPLICATION_PDF_TOO_LARGE");
        const label = cleanPdfText(line.label).slice(0, 200);
        const value = cleanPdfText(line.value);
        document.font("Helvetica-Bold").fontSize(8);
        const labelHeight = document.heightOfString(label, { width: contentWidth });
        document.font("Helvetica").fontSize(10);
        const valueHeight = document.heightOfString(value, { width: contentWidth });
        const rowHeight = labelHeight + valueHeight + 12;
        if (document.y + rowHeight > PAGE_BOTTOM) {
          document.addPage();
          drawPageHeader(document);
        }
        document.fillColor("#64748b").font("Helvetica-Bold").fontSize(8)
          .text(label, { width: contentWidth });
        document.moveDown(0.1);
        document.fillColor("#1e293b").font("Helvetica").fontSize(10)
          .text(value || "—", { width: contentWidth });
        document.moveDown(0.45);
      }
      document.moveDown(0.25);
    }

    if (lineCount === 0) {
      document.fillColor("#475569").font("Helvetica").fontSize(10)
        .text("No additional form fields were provided.");
    }
    document.end();
  });
}
