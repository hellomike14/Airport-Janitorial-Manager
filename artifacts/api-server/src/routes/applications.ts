import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { jobApplicationsTable } from "@workspace/db/schema";
import { SubmitApplicationBody, UpdateApplicationBody } from "@workspace/api-zod";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

/**
 * GET /applications — list submissions (admin/supervisor, gated client-side).
 */
router.get("/", async (req: Request, res: Response) => {
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
    const [created] = await db
      .insert(jobApplicationsTable)
      .values({
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
        documents: (data.documents ?? []) as { name: string; path: string; contentType?: string }[],
      })
      .returning();

    res.status(201).json(created);
  } catch (err) {
    console.error("Error submitting application:", err);
    res.status(500).json({ error: "Failed to submit application" });
  }
});

/**
 * GET /applications/:id — single application detail.
 */
router.get("/:id", async (req: Request, res: Response) => {
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
router.patch("/:id", async (req: Request, res: Response) => {
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

export default router;
