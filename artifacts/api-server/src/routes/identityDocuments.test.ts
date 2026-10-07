import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db, pool } from "@workspace/db";
import { staffTable, onboardingHiresTable, identityDocumentPhotosTable, identityDocumentEventsTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { createIdentityDocumentsRouter, canAccessIdentityHire } from "./identityDocuments";
import { normalizeIdentityPhoto, validateIdentityBytes, MAX_IDENTITY_BYTES } from "../lib/identityPhotoProcessing";
import { ObjectStorageService } from "../lib/objectStorage";
import { identityDocumentStorage } from "../lib/identityDocumentStorage";

interface TestContext { canManage: boolean; hires: { id: number }[]; employees: unknown[] }
interface TestPhoto {
  id: string; status: string; uploadedBy: { id: number }; reviewedBy: { id: number };
  supersededAt: string | null; originalPath?: string; imagePath?: string; stagingPath?: string;
}
interface TestList { photos: TestPhoto[]; events: { action: string }[] }
async function json<T>(response: Response): Promise<T> { return await response.json() as T; }

test("HR photographs are Admin-only, even for the linked employee", () => {
  for (const role of ["supervisor", "inspector"] as const) assert.equal(canAccessIdentityHire({ id: 5, role }, { staffId: 5 }), false);
  assert.equal(canAccessIdentityHire({ id: 5, role: "staff" }, { staffId: 6 }), false);
  assert.equal(canAccessIdentityHire({ id: 5, role: "staff" }, { staffId: null }), false);
  assert.equal(canAccessIdentityHire({ id: 5, role: "staff" }, { staffId: 5 }), false);
  assert.equal(canAccessIdentityHire({ id: 5, role: "admin" }, { staffId: 6 }), true);
});

test("real image decoder rejects disguises, corrupt images and unsafe HEIF dimensions", async () => {
  assert.throws(() => validateIdentityBytes(Buffer.from("<svg/>"), "image/jpeg"));
  assert.throws(() => validateIdentityBytes(Buffer.alloc(MAX_IDENTITY_BYTES + 1), "image/png"));
  await assert.rejects(() => normalizeIdentityPhoto(Buffer.from([255, 216, 255, 0]), "image/jpeg"));
  const png = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#007755" } }).png().toBuffer();
  const jpeg = await normalizeIdentityPhoto(png, "image/png");
  const info = await sharp(jpeg).metadata();
  assert.equal(info.format, "jpeg");
  assert.equal(info.width, 120);
  assert.equal(info.exif, undefined);
  const bomb = Buffer.alloc(44);
  bomb.writeUInt32BE(20); bomb.write("ftyp", 4); bomb.write("heic", 8);
  bomb.writeUInt32BE(20, 20); bomb.write("ispe", 24); bomb.writeUInt32BE(100_000, 32); bomb.writeUInt32BE(100_000, 36);
  assert.throws(() => validateIdentityBytes(bomb, "image/heic"));
});

test("Admin-only private durable upload, review and immutable replacements", {
  skip: process.env.IDENTITY_DOCUMENT_INTEGRATION !== "1",
}, async () => {
  // Only synthetic employees and generated colour swatches: never actual IDs.
  const suffix = randomUUID();
  const people = await db.insert(staffTable).values([
    { name: `Identity test employee ${suffix}`, role: "staff", email: `${suffix}-staff@example.invalid` },
    { name: `Identity test other ${suffix}`, role: "staff", email: `${suffix}-other@example.invalid` },
    { name: `Identity test HR ${suffix}`, role: "admin", email: `${suffix}-hr@example.invalid` },
    { name: `Identity test supervisor ${suffix}`, role: "supervisor", email: `${suffix}-supervisor@example.invalid` },
    { name: `Identity test inspector ${suffix}`, role: "inspector", email: `${suffix}-inspector@example.invalid` },
  ]).returning();
  const [employee, other, admin, supervisor, inspector] = people;
  const records = await db.insert(onboardingHiresTable).values([
    { name: `Identity fixture hire ${suffix}` },
    { name: `Identity fixture other hire ${suffix}`, staffId: other.id },
  ]).returning();
  const [hire, otherHire] = records;
  const app = express();
  app.use(express.json());
  app.use(createIdentityDocumentsRouter({
    resolveActor: async req => people.find(person => person.id === Number(req.headers["x-fixture-actor"])) ?? null,
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/identity-documents`;
  const request = (path: string, actorId: number | null, method = "GET", body?: unknown) =>
    fetch(url + path, { method, headers: { "Content-Type": "application/json", ...(actorId ? { "x-fixture-actor": String(actorId) } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const png = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#007755" } }).png().toBuffer();
  const storage = new ObjectStorageService();
  try {
    assert.equal((await request("/context", null)).status, 401);
    assert.equal((await request("/context", supervisor.id)).status, 403);
    for (const denied of [employee, other, supervisor, inspector]) {
      for (const [path, method, body] of [
        ["/context", "GET", undefined],
        [`?hireId=${otherHire.id}`, "GET", undefined],
        [`/hires/${hire.id}/employee`, "PUT", { staffId: employee.id }],
        ["/uploads", "POST", {}],
        [`/uploads/${suffix}/complete`, "POST", undefined],
        [`/uploads/${suffix}`, "DELETE", undefined],
        [`/${suffix}/image`, "GET", undefined],
        [`/${suffix}/review`, "PATCH", { status: "reviewed" }],
      ] as const) assert.equal((await request(path, denied.id, method, body)).status, 403);
    }
    let context = await json<TestContext>(await request("/context", admin.id));
    assert.equal(context.canManage, true);
    assert.ok(context.employees.length > 0);
    assert.equal((await request(`/hires/${hire.id}/employee`, employee.id, "PUT", { staffId: employee.id })).status, 403);
    assert.equal((await request(`/hires/${hire.id}/employee`, admin.id, "PUT", { staffId: employee.id })).status, 200);
    assert.equal((await request(`/hires/${hire.id}/employee`, admin.id, "PUT", { staffId: other.id })).status, 409);
    context = await json<TestContext>(await request("/context", admin.id));
    assert.ok(context.hires.some(item => item.id === hire.id));
    assert.equal((await request(`?hireId=${otherHire.id}`, employee.id)).status, 403);
    const input = { hireId: hire.id, category: "identity", side: "front", size: png.length, contentType: "image/png", replacesId: null };
    assert.equal((await request("/uploads", other.id, "POST", input)).status, 403);
    assert.equal((await request("/uploads", supervisor.id, "POST", input)).status, 403);
    assert.equal((await request("/uploads", admin.id, "POST", { ...input, size: MAX_IDENTITY_BYTES + 1 })).status, 400);
    assert.equal((await request("/uploads", admin.id, "POST", { ...input, contentType: "image/svg+xml" })).status, 400);
    const start = async (body: unknown) => {
      const response = await request("/uploads", admin.id, "POST", body);
      assert.equal(response.status, 201);
      return response.json() as Promise<{ id: string; uploadURL: string }>;
    };
    const ticket = await start(input);
    assert.equal((await request(`/uploads/${ticket.id}/complete`, other.id, "POST")).status, 403);
    assert.equal((await request(`/${ticket.id}/image`, admin.id)).status, 404);
    const put = await fetch(ticket.uploadURL, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png });
    assert.equal(put.ok, true);
    assert.notEqual((await fetch(ticket.uploadURL, { method: "GET" })).status, 200);
    const completedResponse = await request(`/uploads/${ticket.id}/complete`, admin.id, "POST");
    assert.equal(completedResponse.status, 200);
    const completed = await json<TestPhoto>(completedResponse);
    assert.equal(completed.status, "uploaded");
    assert.equal(completed.uploadedBy.id, admin.id);
    assert.equal(completed.originalPath, undefined);
    assert.equal(completed.imagePath, undefined);
    assert.equal(completed.stagingPath, undefined);
    assert.equal((await request(`/uploads/${ticket.id}/complete`, admin.id, "POST")).status, 200);
    assert.equal((await request(`/${ticket.id}/image`, other.id)).status, 403);
    assert.equal((await request(`/${ticket.id}/image`, employee.id)).status, 403);
    assert.equal((await request(`/${ticket.id}/image`, supervisor.id)).status, 403);
    const image = await request(`/${ticket.id}/image`, admin.id);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("cache-control"), "private, no-store");
    assert.equal(image.headers.get("content-type"), "image/jpeg");
    assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).format, "jpeg");
    const [stored] = await db.select().from(identityDocumentPhotosTable).where(eq(identityDocumentPhotosTable.id, ticket.id));
    const original = await storage.getObjectEntityFile(stored.originalPath!);
    assert.deepEqual((await original.download())[0], png);
    assert.notEqual((await fetch(original.publicUrl())).status, 200);
    assert.equal((await request(`/${ticket.id}/review`, employee.id, "PATCH", { status: "reviewed" })).status, 403);
    assert.equal((await request(`/${ticket.id}/review`, admin.id, "PATCH", { status: "needs_clearer_photo" })).status, 400);
    assert.equal((await request(`/${ticket.id}/review`, admin.id, "PATCH", { status: "needs_clearer_photo", reason: "glare" })).status, 200);
    assert.equal((await request(`/${ticket.id}/review`, admin.id, "PATCH", { status: "reviewed" })).status, 200);
    assert.equal((await request("/uploads", admin.id, "POST", input)).status, 409);
    const replacement = await start({ ...input, replacesId: ticket.id });
    assert.equal((await fetch(replacement.uploadURL, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png })).ok, true);
    assert.equal((await request(`/uploads/${replacement.id}/complete`, admin.id, "POST")).status, 200);
    const list = await json<TestList>(await request(`?hireId=${hire.id}`, admin.id));
    assert.equal(list.photos.length, 2);
    const old = list.photos.find((photo: { id: string }) => photo.id === ticket.id);
    assert.ok(old);
    assert.ok(old.supersededAt);
    assert.equal(old.status, "reviewed");
    assert.equal(old.reviewedBy.id, admin.id);
    assert.equal(list.photos.filter((photo: { supersededAt: string | null }) => !photo.supersededAt).length, 1);
    for (const action of ["employee_linked", "photo_uploaded", "photo_viewed", "needs_clearer_photo", "reviewed", "photo_replaced"]) {
      assert.ok(list.events.some((event: { action: string }) => event.action === action), action);
    }
    assert.equal((await request(`/uploads/${ticket.id}`, admin.id, "DELETE")).status, 200);
    assert.equal((await request(`/${ticket.id}/image`, admin.id)).status, 200);
    const cancelled = await start({ ...input, side: "back" });
    assert.equal((await request(`/uploads/${cancelled.id}`, admin.id, "DELETE")).status, 200);
    assert.equal((await request(`/uploads/${cancelled.id}/complete`, admin.id, "POST")).status, 404);
    // Validation errors must not supersede an existing record.
    const bad = await start({ ...input, replacesId: replacement.id });
    await fetch(bad.uploadURL, { method: "PUT", headers: { "Content-Type": "image/png" }, body: Buffer.alloc(png.length, 0) });
    assert.equal((await request(`/uploads/${bad.id}/complete`, admin.id, "POST")).status, 400);
    await request(`/uploads/${bad.id}`, admin.id, "DELETE");
    const after = await json<TestList>(await request(`?hireId=${hire.id}`, admin.id));
    assert.equal(after.photos.filter((photo: { supersededAt: string | null }) => !photo.supersededAt)[0].id, replacement.id);
    console.log("Verified Admin-only private GCS originals/previews, denied non-admin endpoints, status and immutable history.");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    const hireIds = records.map(record => record.id);
    const owned = await db.select().from(identityDocumentPhotosTable).where(inArray(identityDocumentPhotosTable.hireId, hireIds));
    for (const photo of owned) {
      for (const path of [photo.stagingPath, photo.originalPath, photo.imagePath].filter(Boolean)) {
        try { await (await storage.getObjectEntityFile(path!)).delete({ ignoreNotFound: true }); } catch { /* fixture might already be cancelled */ }
      }
    }
    await db.delete(identityDocumentEventsTable).where(inArray(identityDocumentEventsTable.hireId, hireIds));
    await db.delete(identityDocumentPhotosTable).where(inArray(identityDocumentPhotosTable.hireId, hireIds));
    await db.delete(onboardingHiresTable).where(inArray(onboardingHiresTable.id, hireIds));
    await db.delete(staffTable).where(inArray(staffTable.id, people.map(person => person.id)));
    await pool.end();
  }
});
