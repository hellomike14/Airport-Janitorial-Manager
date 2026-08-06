import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { staffTable } from "@workspace/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  CreateStaffMemberBody,
  UpdateStaffMemberBody,
  UpdateStaffMemberParams,
  DeleteStaffMemberParams,
} from "@workspace/api-zod";
import { setActorCookie, clearActorCookie, actorIdFromRequest } from "../lib/actorSession";

const SALT_ROUNDS = 10;
const PIN_REGEX = /^\d{4}$/;

async function hashPin(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function verifyPin(plain: string, hash: string): Promise<boolean> {
  if (!hash.startsWith("$2")) {
    return plain === hash;
  }
  return bcrypt.compare(plain, hash);
}

const router: IRouter = Router();

router.get("/", async (_req, res) => {
  const staff = await db
    .select()
    .from(staffTable)
    .where(eq(staffTable.active, true))
    .orderBy(staffTable.role, staffTable.name);
  res.json(
    staff.map((s) => {
      const { password, ...rest } = s;
      return {
        ...rest,
        hasPin: !!password,
        createdAt: s.createdAt.toISOString(),
      };
    })
  );
});

router.post("/verify-pin", async (req, res) => {
  const { staffId, pin } = req.body;
  if (!staffId || !pin) {
    res.status(400).json({ error: "staffId and pin required" });
    return;
  }
  if (!PIN_REGEX.test(pin)) {
    res.status(400).json({ error: "PIN must be exactly 4 digits" });
    return;
  }
  const [staff] = await db
    .select()
    .from(staffTable)
    .where(eq(staffTable.id, staffId));
  if (!staff) {
    res.status(404).json({ error: "Staff not found" });
    return;
  }
  if (!staff.password) {
    res.status(401).json({ error: "No PIN set" });
    return;
  }
  const valid = await verifyPin(pin, staff.password);
  if (!valid) {
    res.status(401).json({ error: "Incorrect PIN" });
    return;
  }
  const { password: _, ...rest } = staff;
  setActorCookie(res, staff.id);
  res.json({ ...rest, createdAt: staff.createdAt.toISOString() });
});

// Clear the actor-session cookie on logout so a subsequent login at the same
// browser cannot keep acting as the previous user.
router.post("/logout", (_req, res) => {
  clearActorCookie(res);
  res.json({ success: true });
});

router.post("/set-pin", async (req, res) => {
  const { staffId, pin, currentPin, adminReset } = req.body;
  if (!staffId || !pin) {
    res.status(400).json({ error: "staffId and pin required" });
    return;
  }
  if (!PIN_REGEX.test(pin)) {
    res.status(400).json({ error: "PIN must be exactly 4 digits" });
    return;
  }
  const [staff] = await db
    .select()
    .from(staffTable)
    .where(eq(staffTable.id, staffId));
  if (!staff) {
    res.status(404).json({ error: "Staff not found" });
    return;
  }
  let adminVerified = false;
  if (adminReset === true) {
    // Admin resets are authorized by the requester's authenticated actor
    // session — a client-supplied admin PIN is NOT an acceptable credential.
    const actorId = actorIdFromRequest(req);
    if (actorId === null) {
      res.status(401).json({ error: "Login session required" });
      return;
    }
    const [actor] = await db
      .select()
      .from(staffTable)
      .where(eq(staffTable.id, actorId));
    if (!actor || !actor.active || actor.role !== "admin") {
      res.status(403).json({ error: "Only administrators can reset PINs" });
      return;
    }
    adminVerified = true;
  }
  if (!staff.password && !adminVerified) {
    // First-time PIN enrollment must be authorized by an admin (via the
    // admin-reset path). Self-claiming an unclaimed account would let anyone
    // take over that person's identity. The only exception is bootstrap:
    // when no PIN-protected active admin exists yet, an admin may set their
    // own first PIN.
    const [protectedAdmin] = await db
      .select({ id: staffTable.id })
      .from(staffTable)
      .where(and(eq(staffTable.role, "admin"), eq(staffTable.active, true), isNotNull(staffTable.password)))
      .limit(1);
    const bootstrap = !protectedAdmin && staff.role === "admin";
    if (!bootstrap) {
      res.status(403).json({ error: "ENROLLMENT_REQUIRED" });
      return;
    }
  }
  if (staff.password && !adminVerified) {
    if (!currentPin) {
      res.status(401).json({ error: "Current PIN is required" });
      return;
    }
    if (!PIN_REGEX.test(currentPin)) {
      res.status(400).json({ error: "Current PIN must be exactly 4 digits" });
      return;
    }
    const valid = await verifyPin(currentPin, staff.password);
    if (!valid) {
      res.status(401).json({ error: "Current PIN is incorrect" });
      return;
    }
  }
  const hashed = await hashPin(pin);
  await db
    .update(staffTable)
    .set({ password: hashed })
    .where(eq(staffTable.id, staffId));
  // Successful PIN creation/change by the account holder counts as credential
  // verification, so establish their actor session. Admin resets of someone
  // else's PIN must NOT log the admin in as that person.
  if (!adminVerified) {
    setActorCookie(res, staff.id);
  }
  res.json({ success: true });
});

router.post("/", async (req, res) => {
  const body = CreateStaffMemberBody.parse(req.body);
  const [created] = await db
    .insert(staffTable)
    .values({
      name: body.name,
      role: body.role,
      phone: body.phone ?? null,
      email: body.email ?? null,
      password: null,
    })
    .returning();
  res.status(201).json({ ...created, createdAt: created.createdAt.toISOString() });
});

router.put("/:id", async (req, res) => {
  const { id } = UpdateStaffMemberParams.parse({ id: req.params.id });
  const body = UpdateStaffMemberBody.parse(req.body);
  const updateData: Partial<typeof staffTable.$inferInsert> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.role !== undefined) updateData.role = body.role;
  if (body.phone !== undefined) updateData.phone = body.phone ?? null;
  if (body.email !== undefined) updateData.email = body.email ?? null;
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

router.delete("/:id", async (req, res) => {
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
