import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { staffTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  CreateStaffMemberBody,
  UpdateStaffMemberBody,
  UpdateStaffMemberParams,
  DeleteStaffMemberParams,
} from "@workspace/api-zod";

const SALT_ROUNDS = 10;

async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function verifyPassword(plain: string, hash: string): Promise<boolean> {
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
    .orderBy(staffTable.role, staffTable.name);
  res.json(
    staff.map((s) => {
      const { password, ...rest } = s;
      return {
        ...rest,
        hasPassword: !!password,
        createdAt: s.createdAt.toISOString(),
      };
    })
  );
});

router.post("/verify-password", async (req, res) => {
  const { staffId, password } = req.body;
  if (!staffId || !password) {
    res.status(400).json({ error: "staffId and password required" });
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
    res.status(401).json({ error: "No password set" });
    return;
  }
  const valid = await verifyPassword(password, staff.password);
  if (!valid) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
  const { password: _, ...rest } = staff;
  res.json({ ...rest, createdAt: staff.createdAt.toISOString() });
});

router.post("/set-password", async (req, res) => {
  const { staffId, password, currentPassword } = req.body;
  if (!staffId || !password) {
    res.status(400).json({ error: "staffId and password required" });
    return;
  }
  if (password.length < 4) {
    res.status(400).json({ error: "Password must be at least 4 characters" });
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
  if (staff.password) {
    if (!currentPassword) {
      res.status(401).json({ error: "Current password is required" });
      return;
    }
    const valid = await verifyPassword(currentPassword, staff.password);
    if (!valid) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }
  }
  const hashed = await hashPassword(password);
  await db
    .update(staffTable)
    .set({ password: hashed })
    .where(eq(staffTable.id, staffId));
  res.json({ success: true });
});

router.post("/", async (req, res) => {
  const body = CreateStaffMemberBody.parse(req.body);
  let password: string | null = null;
  if (body.role === "inspector" && body.email) {
    password = await hashPassword(body.email);
  }
  const [created] = await db
    .insert(staffTable)
    .values({
      name: body.name,
      role: body.role,
      phone: body.phone ?? null,
      email: body.email ?? null,
      password,
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
  await db.delete(staffTable).where(eq(staffTable.id, id));
  res.json({ success: true });
});

export default router;
