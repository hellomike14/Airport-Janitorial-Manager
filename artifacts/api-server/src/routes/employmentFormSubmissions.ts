import { and, desc, eq, isNull } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetEmploymentFormSubmissionResponse,
  ListEmploymentFormSubmissionsResponse,
  ResendEmploymentFormSubmissionEmailResponse,
  SubmitEmploymentFormBody,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  employmentFormSubmissionsTable,
  objectUploadsTable,
  type EmploymentFormAttachment,
} from "@workspace/db/schema";
import { requireStaffRole } from "../middlewares/requireStaffRole";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  EMPLOYMENT_FORMS_RECIPIENT,
  MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES,
  sendEmploymentFormEmail,
  sanitizeEmailFilename,
  type EmploymentEmailAttachment,
  type EmploymentEmailSender,
} from "../lib/employmentFormEmail";

const storage = new ObjectStorageService();
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type RouterDependencies = {
  copyApplicantSubmissionObject: (sourcePath: string) => Promise<string>;
  getObjectMetadata: (sourcePath: string) => Promise<{ sizeBytes: number; contentType: string }>;
  readObjectBytes: (path: string, maxBytes: number) => Promise<{ bytes: Buffer; sizeBytes: number; contentType: string }>;
  sendEmail: EmploymentEmailSender;
};

const defaultDependencies: RouterDependencies = {
  copyApplicantSubmissionObject: path => storage.copyApplicantSubmissionObject(path),
  getObjectMetadata: path => storage.getObjectEntityMetadata(path),
  readObjectBytes: (path, maxBytes) => storage.readObjectEntityBytes(path, maxBytes),
  sendEmail: sendEmploymentFormEmail,
};

function formLabel(formId: "job-application" | "i-9" | "w-4"): string {
  if (formId === "i-9") return "Form I-9";
  if (formId === "w-4") return "Form W-4";
  return "Job application";
}

async function getAttachments(
  documents: EmploymentFormAttachment[],
  readObjectBytes: RouterDependencies["readObjectBytes"],
): Promise<EmploymentEmailAttachment[]> {
  const attachments: EmploymentEmailAttachment[] = [];
  let totalBytes = 0;
  for (const document of documents) {
    const file = await readObjectBytes(document.path, MAX_FILE_BYTES);
    if (file.contentType !== document.contentType ||
        !["application/pdf", ...SUPPORTED_PHOTO_TYPES].includes(file.contentType)) {
      throw new Error("INVALID_STORED_APPLICATION_ATTACHMENT");
    }
    totalBytes += file.sizeBytes;
    if (totalBytes > MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES) {
      throw new Error("EMPLOYMENT_EMAIL_ATTACHMENTS_TOO_LARGE");
    }
    attachments.push({
      filename: sanitizeEmailFilename(document.name),
      contentType: file.contentType as EmploymentEmailAttachment["contentType"],
      bytes: file.bytes,
    });
  }
  return attachments;
}

function emailText(submission: {
  formId: "job-application" | "i-9" | "w-4";
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
}): string {
  return [
    `New completed ${formLabel(submission.formId)} and ID-card photos`,
    `Applicant: ${submission.firstName} ${submission.lastName}`,
    `Contact email: ${submission.email}`,
    `Phone: ${submission.phone ?? "(not provided)"}`,
    `The completed ${formLabel(submission.formId)} PDF and any ID-card photos are attached.`,
    `Recipient: ${EMPLOYMENT_FORMS_RECIPIENT}`,
  ].join("\n");
}

export function createEmploymentFormSubmissionsRouter(
  overrides: Partial<RouterDependencies> = {},
): IRouter {
  const deps = { ...defaultDependencies, ...overrides };
  const router: IRouter = Router();

  async function deliverSubmissionEmail(submission: {
    formId: "job-application" | "i-9" | "w-4";
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    completedPdfPath: string;
    idPhotos: EmploymentFormAttachment[];
  }): Promise<void> {
    const completedPdf: EmploymentFormAttachment = {
      name: `Marvol-${submission.formId}-completed.pdf`,
      path: submission.completedPdfPath,
      contentType: "application/pdf",
    };
    const attachments = await getAttachments([completedPdf, ...submission.idPhotos], deps.readObjectBytes);
    await deps.sendEmail({
      subject: `Completed Marvol ${formLabel(submission.formId)}`,
      text: emailText(submission),
      attachments,
    });
  }

  router.post("/", async (req: Request, res: Response): Promise<void> => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = SubmitEmploymentFormBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid employment form submission" });
      return;
    }
    const data = parsed.data;
    const parts = [data.completedPdf, ...(data.idPhotos ?? [])];
    if (data.completedPdf.contentType !== "application/pdf" ||
        (data.idPhotos ?? []).some(photo => !photo.contentType || !SUPPORTED_PHOTO_TYPES.has(photo.contentType))) {
      res.status(400).json({ error: "Invalid form or photo file type" });
      return;
    }
    if (parts.some(part => !part.contentType || part.contentType === "application/pdf" && part !== data.completedPdf)) {
      res.status(400).json({ error: "Invalid uploaded file" });
      return;
    }
    if (new Set(parts.map(part => part.path)).size !== parts.length) {
      res.status(400).json({ error: "Each submitted file must be unique" });
      return;
    }

    let saved: typeof employmentFormSubmissionsTable.$inferSelect | null = null;
    try {
      saved = await db.transaction(async tx => {
        const originals: (typeof objectUploadsTable.$inferSelect)[] = [];
        let uploadBytes = 0;
        for (const part of parts) {
          const [upload] = await tx.select().from(objectUploadsTable).where(and(
            eq(objectUploadsTable.objectPath, part.path),
            eq(objectUploadsTable.applicantToken, part.uploadToken),
            eq(objectUploadsTable.purpose, "application_document"),
            isNull(objectUploadsTable.claimedAt),
          )).for("update");
          if (!upload) throw new Error("INVALID_APPLICATION_UPLOAD");
          const actual = await deps.getObjectMetadata(part.path);
          if (actual.sizeBytes <= 0 || actual.sizeBytes > MAX_FILE_BYTES ||
              actual.sizeBytes !== upload.sizeBytes || actual.contentType !== upload.mimeType ||
              actual.contentType !== part.contentType) {
            throw new Error("INVALID_APPLICATION_UPLOAD");
          }
          uploadBytes += actual.sizeBytes;
          if (uploadBytes > MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES) {
            throw new Error("EMPLOYMENT_EMAIL_ATTACHMENTS_TOO_LARGE");
          }
          originals.push(upload);
        }

        const snapshotPaths: string[] = [];
        for (const [index, part] of parts.entries()) {
          const snapshotPath = await deps.copyApplicantSubmissionObject(part.path);
          const original = originals[index]!;
          await tx.insert(objectUploadsTable).values({
            objectPath: snapshotPath,
            ownerStaffId: null,
            purpose: "application_document",
            applicantToken: null,
            claimedAt: new Date(),
            mimeType: original.mimeType,
            sizeBytes: original.sizeBytes,
          });
          snapshotPaths.push(snapshotPath);
        }

        for (const original of originals) {
          const claimed = await tx.update(objectUploadsTable).set({ claimedAt: new Date() }).where(and(
            eq(objectUploadsTable.objectPath, original.objectPath),
            eq(objectUploadsTable.applicantToken, original.applicantToken!),
            isNull(objectUploadsTable.claimedAt),
          )).returning({ objectPath: objectUploadsTable.objectPath });
          if (!claimed.length) throw new Error("INVALID_APPLICATION_UPLOAD");
        }

        const idPhotos: EmploymentFormAttachment[] = (data.idPhotos ?? []).map((photo, index) => ({
          name: photo.name,
          path: snapshotPaths[index + 1]!,
          contentType: photo.contentType!,
        }));
        const [row] = await tx.insert(employmentFormSubmissionsTable).values({
          formId: data.formId,
          firstName: data.firstName.trim(),
          lastName: data.lastName.trim(),
          email: data.email.trim(),
          phone: data.phone?.trim() || null,
          completedPdfPath: snapshotPaths[0]!,
          idPhotos,
          emailStatus: "pending",
        }).returning();
        return row ?? null;
      });
    } catch (error) {
      if (error instanceof Error && error.message === "EMPLOYMENT_EMAIL_ATTACHMENTS_TOO_LARGE") {
        res.status(413).json({ error: "Uploads exceed the supported email attachment limit" });
        return;
      }
      if (error instanceof Error && error.message === "INVALID_APPLICATION_UPLOAD") {
        res.status(400).json({ error: "Invalid or already claimed uploaded file" });
        return;
      }
      res.status(500).json({ error: "Failed to submit employment form" });
      return;
    }
    if (!saved) {
      res.status(500).json({ error: "Failed to submit employment form" });
      return;
    }

    let emailSent = false;
    try {
      await deliverSubmissionEmail(saved);
      emailSent = true;
    } catch {
      // Keep the private submission and expose its retryable delivery state to Admin.
    }
    try {
      await db.update(employmentFormSubmissionsTable)
        .set({ emailStatus: emailSent ? "sent" : "failed" })
        .where(eq(employmentFormSubmissionsTable.id, saved.id));
    } catch {
      // The receipt remains minimal; the Admin page can retry delivery.
    }
    res.status(201).json({ success: true, emailSent });
  });

  router.get("/", requireStaffRole("admin"), async (req: Request, res: Response): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const rows = await db.select({
      id: employmentFormSubmissionsTable.id,
      formId: employmentFormSubmissionsTable.formId,
      firstName: employmentFormSubmissionsTable.firstName,
      lastName: employmentFormSubmissionsTable.lastName,
      email: employmentFormSubmissionsTable.email,
      phone: employmentFormSubmissionsTable.phone,
      emailStatus: employmentFormSubmissionsTable.emailStatus,
      submittedAt: employmentFormSubmissionsTable.submittedAt,
    }).from(employmentFormSubmissionsTable).orderBy(desc(employmentFormSubmissionsTable.submittedAt));
    res.json(ListEmploymentFormSubmissionsResponse.parse(rows));
  });

  router.get("/:id", requireStaffRole("admin"), async (req: Request, res: Response): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [row] = await db.select().from(employmentFormSubmissionsTable)
      .where(eq(employmentFormSubmissionsTable.id, id)).limit(1);
    if (!row) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }
    res.json(GetEmploymentFormSubmissionResponse.parse(row));
  });

  router.post("/:id/resend-email", requireStaffRole("admin"), async (req: Request, res: Response): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [submission] = await db.select().from(employmentFormSubmissionsTable)
      .where(eq(employmentFormSubmissionsTable.id, id)).limit(1);
    if (!submission) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }
    let emailSent = false;
    try {
      await deliverSubmissionEmail(submission);
      emailSent = true;
    } catch {
      // Keep the existing private record available.
    }
    try {
      await db.update(employmentFormSubmissionsTable)
        .set({ emailStatus: emailSent ? "sent" : "failed" })
        .where(eq(employmentFormSubmissionsTable.id, id));
    } catch {
      // Return the provider result without exposing record data.
    }
    res.json(ResendEmploymentFormSubmissionEmailResponse.parse({ success: true, emailSent }));
  });

  return router;
}

export default createEmploymentFormSubmissionsRouter();
