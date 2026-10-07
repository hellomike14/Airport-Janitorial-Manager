import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { jobApplicationsTable, objectUploadsTable } from "@workspace/db/schema";
import { SubmitApplicationBody, UpdateApplicationBody } from "@workspace/api-zod";
import { eq, desc, and, isNull } from "drizzle-orm";
import { requireStaffRole } from "../middlewares/requireStaffRole";
import { ObjectStorageService } from "../lib/objectStorage";

const objectStorageService = new ObjectStorageService();

export function createApplicationsRouter(
  copyApplicantSubmissionObject: (sourcePath: string) => Promise<string> =
    sourcePath => objectStorageService.copyApplicantSubmissionObject(sourcePath),
): IRouter {
const router: IRouter = Router();
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
  const parsed = SubmitApplicationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  try {
    const data = parsed.data;
    await db.transaction(async (tx) => {
      const documents = data.documents ?? [];
      if (new Set(documents.map(document => document.path)).size !== documents.length) {
        throw new Error("INVALID_APPLICATION_UPLOAD");
      }
      const originalUploads: (typeof objectUploadsTable.$inferSelect)[] = [];
      for (const document of documents) {
        const [upload] = await tx.select().from(objectUploadsTable).where(and(
          eq(objectUploadsTable.objectPath, document.path),
          eq(objectUploadsTable.applicantToken, document.uploadToken),
          eq(objectUploadsTable.purpose, "application_document"),
          isNull(objectUploadsTable.claimedAt),
        )).for("update");
        if (!upload) throw new Error("INVALID_APPLICATION_UPLOAD");
        originalUploads.push(upload);
      }
      // Signed PUT links remain usable for up to 15 minutes. Copy each verified
      // draft into a new private object so later applicant writes cannot alter a
      // completed application or any attached identity photo.
      const completedDocuments: { name: string; path: string; contentType?: string }[] = [];
      for (let index = 0; index < documents.length; index++) {
        const document = documents[index];
        const snapshotPath = await copyApplicantSubmissionObject(document.path);
        const original = originalUploads[index];
        await tx.insert(objectUploadsTable).values({
          objectPath: snapshotPath, ownerStaffId: null, purpose: "application_document",
          applicantToken: null, claimedAt: new Date(), mimeType: original.mimeType,
          sizeBytes: original.sizeBytes,
        });
        completedDocuments.push({ name: document.name, path: snapshotPath, contentType: document.contentType });
      }
      await tx.insert(jobApplicationsTable).values({
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
      });
      for (const upload of originalUploads) {
        const claimed = await tx.update(objectUploadsTable).set({ claimedAt: new Date() }).where(and(
          eq(objectUploadsTable.objectPath, upload.objectPath),
          eq(objectUploadsTable.applicantToken, upload.applicantToken!),
          isNull(objectUploadsTable.claimedAt),
        )).returning({ objectPath: objectUploadsTable.objectPath });
        if (!claimed.length) throw new Error("INVALID_APPLICATION_UPLOAD");
      }
    });

    // Never echo completed personal data or upload paths to the unauthenticated applicant.
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_APPLICATION_UPLOAD") {
      res.status(400).json({ error: "Invalid or already claimed application document" });
      return;
    }
    // Do not log the submitted payload, DB parameters, applicant signatures, or file metadata.
    console.error("Could not save submitted employment application");
    res.status(500).json({ error: "Failed to submit application" });
  }
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
