import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { jobApplicationsTable, objectUploadsTable, type JobApplication } from "@workspace/db/schema";
import {
  EmailApplicationDocumentPdfBody,
  EmailApplicationDocumentPdfParams,
  EmailApplicationPdfBody,
  EmailApplicationPdfParams,
  SubmitApplicationBody,
  UpdateApplicationBody,
} from "@workspace/api-zod";
import { eq, desc, and, isNull } from "drizzle-orm";
import { requireStaffRole } from "../middlewares/requireStaffRole";
import { ObjectStorageService } from "../lib/objectStorage";
import { createEmploymentApplicationPdf } from "../lib/employmentApplicationPdf";
import {
  formatCompletedFields,
  MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES,
  sendEmploymentFormEmail,
  sanitizeEmailFilename,
  type EmploymentEmailAttachment,
  type EmploymentEmailSender,
} from "../lib/employmentFormEmail";

const objectStorageService = new ObjectStorageService();

type ApplicationsRouterDependencies = {
  copyApplicantSubmissionObject: (sourcePath: string) => Promise<string>;
  getObjectMetadata: (sourcePath: string) => Promise<{ sizeBytes: number; contentType: string }>;
  readObjectBytes: (path: string, maxBytes: number) => Promise<{ bytes: Buffer; sizeBytes: number; contentType: string }>;
  sendEmail: EmploymentEmailSender;
  authorizeAdmin: import("express").RequestHandler;
};

const defaultDependencies: ApplicationsRouterDependencies = {
  copyApplicantSubmissionObject: sourcePath => objectStorageService.copyApplicantSubmissionObject(sourcePath),
  getObjectMetadata: sourcePath => objectStorageService.getObjectEntityMetadata(sourcePath),
  readObjectBytes: (path, maxBytes) => objectStorageService.readObjectEntityBytes(path, maxBytes),
  sendEmail: sendEmploymentFormEmail,
  authorizeAdmin: requireStaffRole("admin"),
};

const pdfSignature = Buffer.from("%PDF-");
const maxApplicationDocumentBytes = 10 * 1024 * 1024;

function emailFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "EMPLOYMENT_EMAIL_NOT_CONFIGURED") {
    return { status: 503, reason: "email_not_configured", error: "Email delivery is not configured." };
  }
  if (message === "EMPLOYMENT_EMAIL_ATTACHMENTS_TOO_LARGE" || message === "APPLICATION_PDF_TOO_LARGE") {
    return { status: 413, reason: "attachment_too_large", error: "The PDF is too large to email." };
  }
  if (message === "EMPLOYMENT_EMAIL_INVALID_RECIPIENT") {
    return { status: 400, reason: "invalid_recipient", error: "Enter a valid recipient email address." };
  }
  return {
    status: 502,
    reason: message.startsWith("EMPLOYMENT_EMAIL_REJECTED_") ? "provider_rejected" : "provider_unavailable",
    error: "The application PDF could not be emailed. Please try again.",
  };
}

function recordPdfEmailOutcome(req: Request, outcome: "accepted" | "failed", reason?: string) {
  const fields = {
    feature: "application_pdf_email",
    outcome,
    ...(reason ? { reason } : {}),
  };
  if (outcome === "accepted") req.log?.info(fields, "Application PDF email accepted");
  else req.log?.error(fields, "Application PDF email failed");
}

function parsePositiveId(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function applicationPdfResponse(res: Response, pdf: Buffer): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'inline; filename="Marvol_Employment_Application.pdf"');
  res.send(pdf);
}

function applicationEmailText(application: {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  positionApplied: string | null;
  application: Record<string, unknown>;
  i9Employee: Record<string, unknown>;
  w4Employee: Record<string, unknown>;
}) {
  return [
    "New completed Marvol employment application",
    `Applicant: ${application.firstName} ${application.lastName}`,
    `Contact email: ${application.email ?? "(not provided)"}`,
    `Phone: ${application.phone ?? "(not provided)"}`,
    `Position: ${application.positionApplied ?? "(not provided)"}`,
    "",
    "Job application:",
    formatCompletedFields(application.application),
    "",
    "Form I-9 (employee section):",
    formatCompletedFields(application.i9Employee),
    "",
    "Form W-4 (employee section):",
    formatCompletedFields(application.w4Employee),
  ].join("\n");
}

export function createApplicationsRouter(
  overrides: Partial<ApplicationsRouterDependencies> = {},
): IRouter {
const deps = { ...defaultDependencies, ...overrides };
const router: IRouter = Router();

async function deliverApplicationEmail(application: {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  positionApplied: string | null;
  application: Record<string, unknown>;
  i9Employee: Record<string, unknown>;
  w4Employee: Record<string, unknown>;
  documents: { name: string; path: string; contentType?: string }[];
}): Promise<void> {
  const attachments: EmploymentEmailAttachment[] = [];
  let totalBytes = 0;
  for (const document of application.documents) {
    const file = await deps.readObjectBytes(document.path, 10 * 1024 * 1024);
    if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.contentType) ||
        (document.contentType && document.contentType !== file.contentType)) {
      throw new Error("INVALID_STORED_APPLICATION_ATTACHMENT");
    }
    totalBytes += file.sizeBytes;
    if (totalBytes > MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES) throw new Error("EMPLOYMENT_EMAIL_ATTACHMENTS_TOO_LARGE");
    attachments.push({
      filename: sanitizeEmailFilename(document.name),
      contentType: file.contentType as EmploymentEmailAttachment["contentType"],
      bytes: file.bytes,
    });
  }
  await deps.sendEmail({
    subject: "Completed Marvol employment application",
    text: applicationEmailText(application),
    attachments,
  });
}

/**
 * GET /applications — confidential completed submissions (Admin and access code).
 */
  router.get("/", deps.authorizeAdmin, async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const rows = await db
      .select()
      .from(jobApplicationsTable)
      .orderBy(desc(jobApplicationsTable.createdAt));
    const filtered = status ? rows.filter((r) => r.status === status) : rows;
    res.json(filtered);
  } catch (err) {
    console.error("Error listing applications:", err);
    res.status(500).json({ error: "Failed to list applications" });
  }
});

/**
 * POST /applications — public, unauthenticated submission.
 */
router.post("/", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const parsed = SubmitApplicationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  let savedApplication: JobApplication | null = null;
  try {
    const data = parsed.data;
    if ((data.documents ?? []).length > 5) {
      res.status(413).json({ error: "Too many attachments" });
      return;
    }
    const insertedApplication = await db.transaction(async (tx) => {
      const documents = data.documents ?? [];
      if (new Set(documents.map(document => document.path)).size !== documents.length) {
        throw new Error("INVALID_APPLICATION_UPLOAD");
      }
      const originalUploads: (typeof objectUploadsTable.$inferSelect)[] = [];
      let uploadBytes = 0;
      for (const document of documents) {
        const [upload] = await tx.select().from(objectUploadsTable).where(and(
          eq(objectUploadsTable.objectPath, document.path),
          eq(objectUploadsTable.applicantToken, document.uploadToken),
          eq(objectUploadsTable.purpose, "application_document"),
          isNull(objectUploadsTable.claimedAt),
        )).for("update");
        if (!upload) throw new Error("INVALID_APPLICATION_UPLOAD");
        const actual = await deps.getObjectMetadata(document.path);
        if (actual.sizeBytes <= 0 || actual.sizeBytes > 10 * 1024 * 1024 ||
            actual.sizeBytes !== upload.sizeBytes || actual.contentType !== upload.mimeType ||
            (document.contentType && document.contentType !== actual.contentType) ||
            !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(actual.contentType)) {
          throw new Error("INVALID_APPLICATION_UPLOAD");
        }
        uploadBytes += actual.sizeBytes;
        if (uploadBytes > MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES) throw new Error("EMPLOYMENT_EMAIL_ATTACHMENTS_TOO_LARGE");
        originalUploads.push(upload);
      }
      // Signed PUT links remain usable for up to 15 minutes. Copy each verified
      // draft into a new private object so later applicant writes cannot alter a
      // completed application or any attached identity photo.
      const completedDocuments: { name: string; path: string; contentType?: string }[] = [];
      for (let index = 0; index < documents.length; index++) {
        const document = documents[index];
        const snapshotPath = await deps.copyApplicantSubmissionObject(document.path);
        const original = originalUploads[index];
        await tx.insert(objectUploadsTable).values({
          objectPath: snapshotPath, ownerStaffId: null, purpose: "application_document",
          applicantToken: null, claimedAt: new Date(), mimeType: original.mimeType,
          sizeBytes: original.sizeBytes,
        });
        completedDocuments.push({ name: document.name, path: snapshotPath, contentType: document.contentType });
      }
      const [application] = await tx.insert(jobApplicationsTable).values({
        status: "new",
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email ?? null,
        phone: data.phone ?? null,
        positionApplied: data.positionApplied ?? null,
        application: (data.application ?? {}) as Record<string, unknown>,
        i9Employee: (data.i9Employee ?? {}) as Record<string, unknown>,
        i9Employer: {},
        w4Employee: (data.w4Employee ?? {}) as Record<string, unknown>,
        w4Employer: {},
        documents: completedDocuments,
        emailStatus: null,
      }).returning();
      for (const upload of originalUploads) {
        const claimed = await tx.update(objectUploadsTable).set({ claimedAt: new Date() }).where(and(
          eq(objectUploadsTable.objectPath, upload.objectPath),
          eq(objectUploadsTable.applicantToken, upload.applicantToken!),
          isNull(objectUploadsTable.claimedAt),
        )).returning({ objectPath: objectUploadsTable.objectPath });
        if (!claimed.length) throw new Error("INVALID_APPLICATION_UPLOAD");
      }
      return application;
    });

    savedApplication = insertedApplication ?? null;
  } catch (err) {
    if (err instanceof Error && err.message === "EMPLOYMENT_EMAIL_ATTACHMENTS_TOO_LARGE") {
      res.status(413).json({ error: "Attachments exceed the email size limit" });
      return;
    }
    if (err instanceof Error && err.message === "INVALID_APPLICATION_UPLOAD") {
      res.status(400).json({ error: "Invalid or already claimed application document" });
      return;
    }
    res.status(500).json({ error: "Failed to submit application" });
    return;
  }
  if (!savedApplication) {
    res.status(500).json({ error: "Failed to submit application" });
    return;
  }
  let emailSent = false;
  try {
    await deliverApplicationEmail(savedApplication);
    emailSent = true;
  } catch (error) {
    // Keep the durable record; its Admin-visible delivery status enables retry.
  }
  try {
    await db.update(jobApplicationsTable).set({ emailStatus: emailSent ? "sent" : "failed" }).where(eq(jobApplicationsTable.id, savedApplication.id));
  } catch {
    // Email delivery itself succeeded or failed explicitly in the receipt.
  }
  res.status(201).json({ success: true, emailSent });
});

  router.post("/:id/resend-email", deps.authorizeAdmin, async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "private, no-store");
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [application] = await db.select().from(jobApplicationsTable).where(eq(jobApplicationsTable.id, id)).limit(1);
  if (!application) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  let emailSent = false;
  try {
    await deliverApplicationEmail(application);
    emailSent = true;
  } catch {
    // Keep the private record available even when the provider is unavailable.
  }
  try {
    await db.update(jobApplicationsTable).set({ emailStatus: emailSent ? "sent" : "failed" }).where(eq(jobApplicationsTable.id, id));
  } catch {
    // The client still gets a receipt with the provider's result.
  }
  res.json({ success: true, emailSent });
});

/**
 * GET /applications/:id — single application detail.
 */
  router.get("/:id", deps.authorizeAdmin, async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "private, no-store");
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const [row] = await db
      .select()
      .from(jobApplicationsTable)
      .where(eq(jobApplicationsTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Application not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    console.error("Error fetching application:", err);
    res.status(500).json({ error: "Failed to fetch application" });
  }
});

  router.get("/:id/pdf", deps.authorizeAdmin, async (req: Request, res: Response): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const id = parsePositiveId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: "Invalid application id" });
      return;
    }
    const [application] = await db.select().from(jobApplicationsTable)
      .where(eq(jobApplicationsTable.id, id)).limit(1);
    if (!application) {
      res.status(404).json({ error: "Application not found" });
      return;
    }
    try {
      const pdf = await createEmploymentApplicationPdf(application);
      if (pdf.byteLength > MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES) throw new Error("APPLICATION_PDF_TOO_LARGE");
      if (!pdf.subarray(0, pdfSignature.byteLength).equals(pdfSignature)) throw new Error("INVALID_APPLICATION_PDF");
      applicationPdfResponse(res, pdf);
    } catch (error) {
      req.log?.error({ feature: "application_pdf", reason: "render_failed" }, "Application PDF could not be generated");
      const status = error instanceof Error && error.message === "APPLICATION_PDF_TOO_LARGE" ? 413 : 503;
      res.status(status).json({
        error: status === 413
          ? "The application PDF exceeds the supported size limit."
          : "The application PDF could not be prepared. Please try again.",
      });
    }
  });

  router.post("/:id/email-pdf", deps.authorizeAdmin, async (req: Request, res: Response): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const params = EmailApplicationPdfParams.safeParse(req.params);
    const body = EmailApplicationPdfBody.strict().safeParse(req.body);
    if (!params.success || !body.success) {
      recordPdfEmailOutcome(req, "failed", "invalid_request");
      res.status(400).json({ error: "Enter a valid application id and recipient email address." });
      return;
    }
    const [application] = await db.select().from(jobApplicationsTable)
      .where(eq(jobApplicationsTable.id, params.data.id)).limit(1);
    if (!application) {
      recordPdfEmailOutcome(req, "failed", "application_not_found");
      res.status(404).json({ error: "Application not found." });
      return;
    }
    let pdf: Buffer;
    try {
      pdf = await createEmploymentApplicationPdf(application);
      if (pdf.byteLength > MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES) {
        res.status(413).json({ error: "The application PDF exceeds the supported size limit." });
        return;
      }
      if (!pdf.subarray(0, pdfSignature.byteLength).equals(pdfSignature)) {
        throw new Error("INVALID_APPLICATION_PDF");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "APPLICATION_PDF_TOO_LARGE") {
        res.status(413).json({ error: "The application PDF exceeds the supported size limit." });
        return;
      }
      req.log?.error({ feature: "application_pdf_email", reason: "render_failed" }, "Application PDF email could not be prepared");
      res.status(503).json({ error: "The application PDF could not be prepared. Please try again." });
      return;
    }
    try {
      await deps.sendEmail({
        to: body.data.recipientEmail,
        subject: "Confidential Marvol employment application",
        text: "The confidential completed Marvol employment application PDF is attached.",
        attachments: [{
          filename: "Marvol_Employment_Application.pdf",
          contentType: "application/pdf",
          bytes: pdf,
        }],
      });
      recordPdfEmailOutcome(req, "accepted");
      res.status(202).json({ accepted: true });
    } catch (error) {
      const failure = emailFailure(error);
      recordPdfEmailOutcome(req, "failed", failure.reason);
      res.status(failure.status).json({ error: failure.error });
    }
  });

  router.post("/:id/documents/:documentIndex/email", deps.authorizeAdmin, async (req: Request, res: Response): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const params = EmailApplicationDocumentPdfParams.safeParse(req.params);
    const body = EmailApplicationDocumentPdfBody.strict().safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Enter a valid application, document, and recipient." });
      return;
    }
    const [application] = await db.select().from(jobApplicationsTable)
      .where(eq(jobApplicationsTable.id, params.data.id)).limit(1);
    if (!application) {
      res.status(404).json({ error: "Application not found." });
      return;
    }
    const documents = application.documents as Array<{ name: string; path: string; contentType?: string }> | null;
    const selected = documents?.[params.data.documentIndex];
    if (!selected) {
      res.status(404).json({ error: "Application document not found." });
      return;
    }
    let file: Awaited<ReturnType<ApplicationsRouterDependencies["readObjectBytes"]>>;
    try {
      file = await deps.readObjectBytes(selected.path, maxApplicationDocumentBytes);
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === "EMPLOYMENT_EMAIL_ATTACHMENTS_TOO_LARGE";
      req.log?.error(
        { feature: "application_document_pdf_email", reason: tooLarge ? "attachment_too_large" : "document_unavailable" },
        "Application document could not be loaded for email",
      );
      res.status(tooLarge ? 413 : 503).json({
        error: tooLarge
          ? "The uploaded PDF is too large to email."
          : "The uploaded document is unavailable. Please try again.",
      });
      return;
    }
    if (file.sizeBytes <= 0 || file.sizeBytes > maxApplicationDocumentBytes) {
      res.status(413).json({ error: "The uploaded PDF is too large to email." });
      return;
    }
    if (file.sizeBytes !== file.bytes.byteLength ||
        file.contentType !== "application/pdf" ||
        (selected.contentType && selected.contentType !== "application/pdf") ||
        file.bytes.byteLength < pdfSignature.byteLength ||
        !file.bytes.subarray(0, pdfSignature.byteLength).equals(pdfSignature)) {
      res.status(415).json({ error: "The selected uploaded document is not a valid PDF." });
      return;
    }
    try {
      await deps.sendEmail({
        to: body.data.recipientEmail,
        subject: "Confidential Marvol application document",
        text: "The selected confidential Marvol application PDF is attached.",
        attachments: [{
          filename: sanitizeEmailFilename(selected.name),
          contentType: "application/pdf",
          bytes: file.bytes,
        }],
      });
      recordPdfEmailOutcome(req, "accepted");
      res.status(202).json({ accepted: true });
    } catch (error) {
      const failure = emailFailure(error);
      recordPdfEmailOutcome(req, "failed", failure.reason);
      res.status(failure.status).json({ error: failure.error });
    }
  });

/**
 * PATCH /applications/:id — update status and employer-side I-9/W-4 fields.
 */
  router.patch("/:id", deps.authorizeAdmin, async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "private, no-store");
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateApplicationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.i9Employer !== undefined) updates.i9Employer = parsed.data.i9Employer;
    if (parsed.data.w4Employer !== undefined) updates.w4Employer = parsed.data.w4Employer;

    const [updated] = await db
      .update(jobApplicationsTable)
      .set(updates)
      .where(eq(jobApplicationsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Application not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    console.error("Error updating application:", err);
    res.status(500).json({ error: "Failed to update application" });
  }
});

  return router;
}

export default createApplicationsRouter();
