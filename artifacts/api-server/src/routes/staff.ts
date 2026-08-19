import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { staffTable } from "@workspace/db/schema";
import { eq, sql, and, ne } from "drizzle-orm";
import {
  CreateStaffMemberBody,
  UpdateStaffMemberBody,
  UpdateStaffMemberParams,
  DeleteStaffMemberParams,
} from "@workspace/api-zod";
import { actorStaffFromRequest } from "../lib/actorSession";
import { requireStaffRole } from "../middlewares/requireStaffRole";

const router: IRouter = Router();

router.get("/", async (_req, res) => {
  const staff = await db
    .select()
    .from(staffTable)
    .where(eq(staffTable.active, true))
    .orderBy(staffTable.role, staffTable.name);
  res.json(
    staff.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
    }))
  );
});

// Resolves the acting staff member from the verified Clerk session (matched
// by email). This is the client's session bridge after Clerk sign-in.
router.get("/me", async (req, res) => {
  const staff = await actorStaffFromRequest(req);
  if (!staff) {
    res.status(404).json({ error: "NO_STAFF_MATCH" });
    return;
  }
  res.json({ ...staff, createdAt: staff.createdAt.toISOString() });
});

// Email is the Clerk↔staff join key: it must be unique (case-insensitive)
// among active staff, or one account could resolve to the wrong person.
async function emailTakenByOther(email: string, excludeId?: number): Promise<boolean> {
  const conditions = [
    sql`lower(${staffTable.email}) = ${email.toLowerCase()}`,
    eq(staffTable.active, true),
  ];
  if (excludeId !== undefined) conditions.push(ne(staffTable.id, excludeId));
  const [existing] = await db
    .select({ id: staffTable.id })
    .from(staffTable)
    .where(and(...conditions))
    .limit(1);
  return !!existing;
}

router.post("/", requireStaffRole("admin"), async (req, res) => {
  const body = CreateStaffMemberBody.parse(req.body);
  const email = body.email?.trim();
  if (!email) {
    res.status(400).json({ error: "Email is required — staff sign in with their email account" });
    return;
  }
  if (await emailTakenByOther(email)) {
    res.status(409).json({ error: "Another active staff member already uses this email" });
    return;
  }
  const [created] = await db
    .insert(staffTable)
    .values({
      name: body.name,
      role: body.role,
      phone: body.phone ?? null,
      email,
    })
    .returning();
  res.status(201).json({ ...created, createdAt: created.createdAt.toISOString() });
});

router.put("/:id", requireStaffRole("admin"), async (req, res) => {
  const { id } = UpdateStaffMemberParams.parse({ id: req.params.id });
  const body = UpdateStaffMemberBody.parse(req.body);
  const updateData: Partial<typeof staffTable.$inferInsert> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.role !== undefined) updateData.role = body.role;
  if (body.phone !== undefined) updateData.phone = body.phone ?? null;
  if (body.email !== undefined) {
    const email = body.email?.trim() || null;
    if (email && (await emailTakenByOther(email, id))) {
      res.status(409).json({ error: "Another active staff member already uses this email" });
      return;
    }
    updateData.email = email;
  }
  if (body.active !== undefined) updateData.active = body.active;

  const [updated] = await db
    .update(staffTable)
    .set(updateData)
    .where(eq(staffTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.delete("/:id", requireStaffRole("admin"), async (req, res) => {
  const { id } = DeleteStaffMemberParams.parse({ id: req.params.id });
  const [updated] = await db
    .update(staffTable)
    .set({ active: false })
    .where(eq(staffTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }
  res.json({ success: true });
});

export default router;
