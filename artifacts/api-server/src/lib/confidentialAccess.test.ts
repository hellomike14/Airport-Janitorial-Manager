import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";
import { db, pool } from "@workspace/db";
import { staffTable, confidentialSettingsTable as settings, confidentialAttemptsTable as attempts, confidentialGrantsTable as grants, confidentialEventsTable as events } from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { createConfidentialService, ConfidentialError, type ConfidentialIdentity } from "./confidentialAccess";
import { isConfidentialRequest } from "../middlewares/confidentialAreas";

test("confidential classification leaves operational APIs and the session bridge alone", () => {
  for (const path of ["/identity-documents/context", "/quickbooks/callback", "/staff/confidential", "/staff/former", "/auth-diagnostics", "/storage/objects/hr-identity/original/example", "/applications", "/applications/17"]) assert.equal(isConfidentialRequest(path, "GET"), true, path);
  assert.equal(isConfidentialRequest("/employment-forms/i-9", "POST"), true);
  for (const path of ["/employment-forms/job-application/email", "/employment-forms/i-9/email", "/employment-forms/w-4/email"]) {
    assert.equal(isConfidentialRequest(path, "POST"), false, path);
  }
  assert.equal(isConfidentialRequest("/employment-forms/i-9/email", "GET"), true);
  for (const [path, method] of [
    ["/applications/42/pdf", "GET"],
    ["/applications/42/email-pdf", "POST"],
    ["/applications/42/documents/0/email", "POST"],
    ["/employment-form-submissions/42/email-pdf", "POST"],
  ]) {
    assert.equal(isConfidentialRequest(path, method), true, `${method} ${path}`);
  }
  for (const path of ["/QuickBooks/status", "/staff/%63onfidential", "/storage/objects/%68r-identity/original/example"]) assert.equal(isConfidentialRequest(path, "GET"), true, path);
  for (const path of ["/EMPLOYMENT-FORMS/i-9", "/storage/objects/uploads/8a6c3ec0-65c4-4301-8abe-232454503365", "/storage/objects/uploads/%38a6c3ec0-65c4-4301-8abe-232454503365"]) assert.equal(isConfidentialRequest(path, "GET"), false, path);
  for (const path of ["/staff", "/staff/me", "/tasks", "/assignments", "/employee-training", "/onboarding-protocol"]) assert.equal(isConfidentialRequest(path, "GET"), false, path);
  assert.equal(isConfidentialRequest("/staff/12", "PUT"), true);
  assert.equal(isConfidentialRequest("/applications", "POST"), false);
  assert.equal(isConfidentialRequest("/applications/17", "POST"), true);
  for (const path of ["/employment-forms/job-application", "/employment-forms/i-9", "/storage/objects/uploads/354716d4-2967-439f-a9f3-ac4bf6ad01e8"]) assert.equal(isConfidentialRequest(path, "GET"), false, path);
  assert.equal(isConfidentialRequest("/storage/objects/uploads/ordinary-photo", "GET"), false);
});
test("credential, session binding, durable lockout, rotation, expiry and OAuth state", {
  skip: process.env.CONFIDENTIAL_INTEGRATION !== "1",
}, async () => {
  const settingsId = randomInt(1_000_000, 2_000_000), suffix = randomUUID();
  const people = await db.insert(staffTable).values([
    { name: `Confidential fixture ${suffix} A`, email: `${suffix}-a@example.invalid`, role: "admin" },
    { name: `Confidential fixture ${suffix} B`, email: `${suffix}-b@example.invalid`, role: "admin" },
    { name: `Confidential fixture ${suffix} C`, email: `${suffix}-c@example.invalid`, role: "staff" },
  ]).returning();
  const [a, b, c] = people;
  const owner: ConfidentialIdentity = { staffId: a.id, sessionId: randomUUID(), role: "admin" };
  const other: ConfidentialIdentity = { staffId: b.id, sessionId: randomUUID(), role: "admin" };
  const worker: ConfidentialIdentity = { staffId: c.id, sessionId: randomUUID(), role: "staff" };
  const gate = createConfidentialService(settingsId);
  const status = (value: number) => (e: unknown) => e instanceof ConfidentialError && e.status === value;
  try {
    assert.equal((await gate.status(owner, "")).configured, false);
    await assert.rejects(() => gate.require(owner, ""), status(423));
    await assert.rejects(() => gate.configure(worker, "", "88114477"), status(403));
    await assert.rejects(() => gate.configure(owner, "", "11111111"), status(400));
    await assert.rejects(() => gate.configure(owner, "", "short"), status(400));
    const first = await gate.configure(owner, "", "88114477");
    assert.equal((await gate.status(owner, first.token)).unlocked, true);
    const [stored] = await db.select().from(settings).where(eq(settings.id, settingsId));
    assert.notEqual(stored.codeHash, "88114477");
    assert.ok(stored.codeHash!.includes(":"));
    await assert.rejects(() => gate.require(worker, first.token), status(403));
    await assert.rejects(() => gate.require(other, first.token), status(423));
    await assert.rejects(() => gate.require({ ...owner, sessionId: randomUUID() }, first.token), status(423));
    await assert.rejects(() => gate.configure(other, "", "99225566", "88114477"), status(423));
    // Serialized attempts must commit even though their HTTP-equivalent operation fails.
    const failures = await Promise.all(Array.from({ length: 5 }, () => gate.unlock(other, "99887766").then(() => 0, e => e.status)));
    assert.equal(failures.filter(value => value === 401).length, 4);
    assert.equal(failures.filter(value => value === 429).length, 1);
    await assert.rejects(() => gate.unlock(other, "88114477"), status(429));
    assert.ok((await gate.status(other, "")).lockedUntil);
    await db.update(attempts).set({ lockedUntil: new Date(Date.now() - 1), windowStart: new Date(Date.now() - 16 * 60_000) })
      .where(and(eq(attempts.settingsId, settingsId), eq(attempts.staffId, b.id)));
    const second = await gate.unlock(other, "88114477");
    const oauth = await gate.startQuickbooks(owner, first.token);
    await assert.rejects(() => gate.consumeQuickbooks(owner, first.token, "wrong-state"), status(403));
    await gate.consumeQuickbooks(owner, first.token, oauth);
    await assert.rejects(() => gate.consumeQuickbooks(owner, first.token, oauth), status(403));
    await assert.rejects(() => gate.configure(owner, first.token, "99225566", "88772266"), status(401));
    const rotated = await gate.configure(owner, first.token, "99225566", "88114477");
    assert.equal((await gate.status(owner, first.token)).unlocked, false);
    assert.equal((await gate.status(other, second.token)).unlocked, false);
    assert.equal((await gate.status(owner, rotated.token)).unlocked, true);
    const allGrants = await db.select().from(grants).where(eq(grants.settingsId, settingsId));
    assert.equal(JSON.stringify(allGrants).includes(rotated.token), false);
    await db.update(grants).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(grants.settingsId, settingsId));
    await assert.rejects(() => gate.require(owner, rotated.token), status(423));
    const fresh = await gate.unlock(owner, "99225566");
    await gate.lock(owner, fresh.token);
    await assert.rejects(() => gate.require(owner, fresh.token), status(423));
    const audit = await db.select().from(events).where(eq(events.settingsId, settingsId));
    for (const action of ["code_configured", "code_changed", "unlock_failed", "unlocked", "locked"]) assert.ok(audit.some(item => item.action === action));
  } finally {
    try { await db.delete(settings).where(eq(settings.id, settingsId)); }
    finally {
      await db.delete(staffTable).where(inArray(staffTable.id, people.map(person => person.id)));
      await pool.end();
    }
  }
});
