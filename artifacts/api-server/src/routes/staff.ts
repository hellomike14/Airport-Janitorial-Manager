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
import { resolveActorStaffFromRequest } from "../lib/actorSession";
import {
  isAppAccessDeniedEmail,
  normalizeLoginEmail,
} from "../lib/loginIdentity";
import { requireStaffRole } from "../middlewares/requireStaffRole";
import type { StaffRow } from "../lib/actorSession";

const router: IRouter = Router();

function toPublicStaff(staff: typeof staffTable.$inferSelect, includeLoginDetails = false) {
  return {
    id: staff.id,
    name: staff.name,
    role: staff.role,
    hasEmail: staff.loginEnabled && Boolean(staff.email?.trim()),
    active: staff.active,
    createdAt: staff.createdAt.toISOString(),
    ...(includeLoginDetails
      ? { email: staff.email, loginEnabled: staff.loginEnabled }
      : {}),
  };
}

router.get("/", async (_req, res) => {
  const actor = res.locals.staffActor as StaffRow;
  const includeLoginDetails = actor.role === "admin";
  const staff = await db
    .select()
    .from(staffTable)
    .where(eq(staffTable.active, true))
    .orderBy(staffTable.role, staffTable.name);
  res.json(staff.map((member) => toPublicStaff(member, includeLoginDetails)));
});

// Resolves the acting staff member from the verified Clerk session (matched
// by email). This is the client's session bridge after Clerk sign-in.
router.get("/me", async (req, res) => {
  const result = await resolveActorStaffFromRequest(req);
  if (result.status === "unauthenticated") {
    res.status(401).json({ error: "Login session required" });
    return;
  }
  if (result.status === "clerk_unavailable") {
    res.status(503).json({ error: "AUTH_SERVICE_UNAVAILABLE" });
    return;
  }
  if (result.status !== "ok") {
    res.status(404).json({ error: "NO_STAFF_MATCH" });
    return;
  }
  res.json(toPublicStaff(result.staff));
});

// Email is the Clerk↔staff join key: it must be unique (case-insensitive)
// among active staff, or one account could resolve to the wrong person.
async function emailTakenByOther(email: string, excludeId?: number): Promise<boolean> {
  const normalizedEmail = normalizeLoginEmail(email);
  const conditions = [
    sql`lower(btrim(${staffTable.email})) = ${normalizedEmail}`,
    eq(staffTable.active, true),
    eq(staffTable.loginEnabled, true),
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
  const email = body.email ? normalizeLoginEmail(body.email) : "";
  if (!email) {
    res.status(400).json({ error: "Email is required — staff sign in with their email account" });
    return;
  }
  if (isAppAccessDeniedEmail(email)) {
    res.status(400).json({ error: "This address is notification-only and cannot be used to sign in" });
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
  res.status(201).json(toPublicStaff(created, true));
});

router.put("/:id", requireStaffRole("admin"), async (req, res) => {
  const { id } = UpdateStaffMemberParams.parse({ id: req.params.id });
  const body = UpdateStaffMemberBody.parse(req.body);
  const [current] = await db
    .select()
    .from(staffTable)
    .where(eq(staffTable.id, id))
    .limit(1);
  if (!current) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }

  const updateData: Partial<typeof staffTable.$inferInsert> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.role !== undefined) updateData.role = body.role;
  if (body.phone !== undefined) updateData.phone = body.phone ?? null;
  if (body.email !== undefined) {
    const email = body.email ? normalizeLoginEmail(body.email) : null;
    if (email && isAppAccessDeniedEmail(email)) {
      res.status(400).json({ error: "This address is notification-only and cannot be used to sign in" });
      return;
    }
    updateData.email = email;
  }
  if (body.active !== undefined) updateData.active = body.active;

  const nextEmail = updateData.email !== undefined ? updateData.email : current.email;
  const nextActive = updateData.active ?? current.active;
  if (nextActive && nextEmail && isAppAccessDeniedEmail(nextEmail)) {
    res.status(400).json({
      error: "This notification-only address cannot be activated for app access",
    });
    return;
  }
  if (
    nextEmail &&
    nextActive &&
    current.loginEnabled &&
    (await emailTakenByOther(nextEmail, id))
  ) {
    res.status(409).json({ error: "Another active staff member already uses this email" });
    return;
  }

  const [updated] = await db
    .update(staffTable)
    .set(updateData)
    .where(eq(staffTable.id, id))
    .returning();
  res.json(toPublicStaff(updated, true));
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
