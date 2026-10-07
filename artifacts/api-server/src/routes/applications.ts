import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { jobApplicationsTable, objectUploadsTable, type JobApplication } from "@workspace/db/schema";
import { SubmitApplicationBody, UpdateApplicationBody } from "@workspace/api-zod";
import { eq, desc, and, isNull } from "drizzle-orm";
import { requireStaffRole } from "../middlewares/requireStaffRole";
import { ObjectStorageService } from "../lib/objectStorage";
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
};

const defaultDependencies: ApplicationsRouterDependencies = {
  copyApplicantSubmissionObject: sourcePath => objectStorageService.copyApplicantSubmissionObject(sourcePath),
  getObjectMetadata: sourcePath => objectStorageService.getObjectEntityMetadata(sourcePath),
  readObjectBytes: (path, maxBytes) => objectStorageService.readObjectEntityBytes(path, maxBytes),
  sendEmail: sendEmploymentFormEmail,
};

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
router.get("/", requireStaffRole("admin"), async (req: Request, res: Response) => {
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

router.post("/:id/resend-email", requireStaffRole("admin"), async (req: Request, res: Response) => {
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
router.get("/:id", requireStaffRole("admin"), async (req: Request, res: Response) => {
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

/**
 * PATCH /applications/:id — update status and employer-side I-9/W-4 fields.
 */
router.patch("/:id", requireStaffRole("admin"), async (req: Request, res: Response) => {
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
