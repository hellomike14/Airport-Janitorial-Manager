import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { staffAccessChangesTable, staffTable } from "@workspace/db/schema";
import { eq, sql, and, ne } from "drizzle-orm";
import {
  CreateStaffMemberBody,
  UpdateStaffMemberBody,
  UpdateStaffMemberParams,
  DeleteStaffMemberParams,
} from "@workspace/api-zod";
import { actorStaffFromRequest, resolveStaffIdentity } from "../lib/actorSession";
import { requireStaffRole } from "../middlewares/requireStaffRole";
import { loginEnabledAfterAdminUpdate } from "../lib/staffLoginPolicy";
import { getAuth } from "@clerk/express";
import {
  accessChangeValues,
  accessSnapshot,
  safeRecordServerDiagnostic,
  type ServerDiagnosticCode,
} from "../lib/authDiagnostics";

const router: IRouter = Router();

function toPublicStaff(staff: typeof staffTable.$inferSelect) {
  return {
    id: staff.id,
    name: staff.name,
    role: staff.role,
    hasEmail: Boolean(staff.email),
    active: staff.active,
    loginEnabled: staff.loginEnabled,
    formerEmployee: staff.formerEmployee,
    createdAt: staff.createdAt.toISOString(),
  };
}

router.get("/", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const staff = await db
    .select()
    .from(staffTable)
    .where(eq(staffTable.active, true))
    .orderBy(staffTable.role, staffTable.name);
  // Operational selectors never need private contact details, even when an
  // administrator happens to be unlocked in another part of the app.
  res.json(staff.map(toPublicStaff));
});

router.get("/confidential", requireStaffRole("admin"), async (_req, res) => {
  // The mounted confidential-area middleware verifies the session-bound code.
  res.setHeader("Cache-Control", "private, no-store");
  const people = await db.select().from(staffTable).where(eq(staffTable.active, true)).orderBy(staffTable.role, staffTable.name);
  res.json(people.map(person => ({ ...toPublicStaff(person), email: person.email, phone: person.phone })));
});

// Resolves the acting staff member from the verified Clerk session (matched
// by email). This is the client's session bridge after Clerk sign-in.
router.get("/me", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!getAuth(req)?.userId) {
    const diagnosticId = await safeRecordServerDiagnostic("SESSION_EXPIRED");
    res.status(401).json({ error: "SESSION_EXPIRED", diagnosticId });
    return;
  }
  const resolution = await resolveStaffIdentity(req);
  if (resolution.status !== "matched") {
    const code: ServerDiagnosticCode = resolution.status === "access_disabled"
      ? "STAFF_ACCESS_DISABLED"
      : "NO_STAFF_MATCH";
    const diagnosticId = await safeRecordServerDiagnostic(code);
    res.status(code === "STAFF_ACCESS_DISABLED" ? 403 : 404).json({ error: code, diagnosticId });
    return;
  }
  res.json(toPublicStaff(resolution.staff));
});

router.get("/former", requireStaffRole("admin"), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const archived = await db.select().from(staffTable)
    .where(and(eq(staffTable.formerEmployee, true), eq(staffTable.active, false), eq(staffTable.role, "staff")))
    .orderBy(staffTable.name);
  res.json(archived.map(toPublicStaff));
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
  const actor = await actorStaffFromRequest(req);
  if (!actor) return res.status(401).json({ error: "Login session required" });
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
  const created = await db.transaction(async tx => {
    const [staff] = await tx.insert(staffTable).values({
      name: body.name,
      role: body.role,
      phone: body.phone ?? null,
      email,
    }).returning();
    const after = accessSnapshot(staff);
    await tx.insert(staffAccessChangesTable).values(accessChangeValues({
      actor,
      staff,
      action: "CREATE",
      before: { active: false, loginEnabled: false, formerEmployee: false, hasEmail: false },
      after,
    }));
    return staff;
  });
  return res.status(201).json(toPublicStaff(created));
});

router.put("/:id", requireStaffRole("admin"), async (req, res) => {
  const actor = await actorStaffFromRequest(req);
  if (!actor) return res.status(401).json({ error: "Login session required" });
  const { id } = UpdateStaffMemberParams.parse({ id: req.params.id });
  const body = UpdateStaffMemberBody.parse(req.body);
  const result = await db.transaction(async tx => {
    const [before] = await tx.select().from(staffTable)
      .where(eq(staffTable.id, id))
      .for("update");
    if (!before) return { status: "not_found" as const };
    if (before.formerEmployee && (body.active === true || (body.name !== undefined && body.name !== before.name))) {
      return { status: "former" as const };
    }
    const updateData: Partial<typeof staffTable.$inferInsert> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.role !== undefined) updateData.role = body.role;
    if (body.phone !== undefined) updateData.phone = body.phone ?? null;
    if (body.email !== undefined) {
      const email = body.email?.trim() || null;
      if (email) {
        const [existing] = await tx.select({ id: staffTable.id }).from(staffTable)
          .where(and(
            sql`lower(${staffTable.email}) = ${email.toLowerCase()}`,
            eq(staffTable.active, true),
            ne(staffTable.id, id),
          ))
          .limit(1);
        if (existing) return { status: "email_taken" as const };
      }
      updateData.email = email;
    }
    if (body.active !== undefined) updateData.active = body.active;
    updateData.loginEnabled = loginEnabledAfterAdminUpdate(before, {
      active: body.active,
      email: body.email === undefined ? undefined : body.email?.trim() || null,
    });
    const [staff] = await tx.update(staffTable)
      .set(updateData)
      .where(eq(staffTable.id, id))
      .returning();
    if (!staff) return { status: "not_found" as const };
    await tx.insert(staffAccessChangesTable).values(accessChangeValues({
      actor,
      staff,
      action: "UPDATE",
      before: accessSnapshot(before),
      after: accessSnapshot(staff),
    }));
    return { status: "updated" as const, staff };
  });
  if (result.status === "not_found") return res.status(404).json({ error: "Staff member not found" });
  if (result.status === "former") return res.status(403).json({ error: "Former staff records cannot be renamed or reactivated" });
  if (result.status === "email_taken") return res.status(409).json({ error: "Another active staff member already uses this email" });
  return res.json(toPublicStaff(result.staff));
});

router.post("/:id/rehire", requireStaffRole("admin"), async (req, res) => {
  const actor = await actorStaffFromRequest(req);
  if (!actor) { res.status(401).json({ error: "Login session required" }); return; }
  const { id } = UpdateStaffMemberParams.parse({ id: req.params.id });
  const result = await db.transaction(async tx => {
    const [before] = await tx.select().from(staffTable).where(eq(staffTable.id, id)).for("update");
    if (!before) return { status: "not_found" as const };
    if (!before.formerEmployee || before.active || before.role !== "staff") return { status: "not_former" as const };
    const [staff] = await tx.update(staffTable)
      .set({ active: true, formerEmployee: false, loginEnabled: false })
      .where(eq(staffTable.id, id))
      .returning();
    await tx.insert(staffAccessChangesTable).values(accessChangeValues({
      actor, staff, action: "UPDATE",
      before: accessSnapshot(before), after: accessSnapshot(staff),
    }));
    return { status: "updated" as const, staff };
  });
  if (result.status === "not_found") { res.status(404).json({ error: "Staff member not found" }); return; }
  if (result.status === "not_former") { res.status(409).json({ error: "Only archived former staff can be rehired" }); return; }
  res.json(toPublicStaff(result.staff));
});

router.delete("/:id", requireStaffRole("admin"), async (req, res) => {
  const actor = await actorStaffFromRequest(req);
  if (!actor) return res.status(401).json({ error: "Login session required" });
  const { id } = DeleteStaffMemberParams.parse({ id: req.params.id });
  const updated = await db.transaction(async tx => {
    const [before] = await tx.select().from(staffTable)
      .where(eq(staffTable.id, id))
      .for("update");
    if (!before) return undefined;
    const [staff] = await tx.update(staffTable)
      .set({ active: false, loginEnabled: false })
      .where(eq(staffTable.id, id))
      .returning();
    await tx.insert(staffAccessChangesTable).values(accessChangeValues({
      actor,
      staff,
      action: "DELETE",
      before: accessSnapshot(before),
      after: accessSnapshot(staff),
    }));
    return staff;
  });
  if (!updated) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }
  return res.json({ success: true });
});

export default router;
