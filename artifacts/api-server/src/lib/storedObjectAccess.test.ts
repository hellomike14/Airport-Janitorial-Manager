import assert from "node:assert/strict";
import test from "node:test";
import type { VerifiedUploadRecord } from "./secureUpload";

process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://unused:unused@127.0.0.1:5432/unused";

const { canReadStoredObject } = await import("./storedObjectAccess");

const applicationRecord: VerifiedUploadRecord = {
  version: 1,
  objectPath: "/objects/uploads/4df7435d-1736-4a1f-9ca2-6887a6ee7773",
  name: "i9.pdf",
  size: 100,
  contentType: "application/pdf",
  purpose: "application-document",
  ownerStaffId: null,
};

test("application documents are limited to HR management roles", () => {
  assert.equal(canReadStoredObject({ role: "admin" }, applicationRecord, null), true);
  assert.equal(canReadStoredObject({ role: "supervisor" }, applicationRecord, null), true);
  assert.equal(canReadStoredObject({ role: "staff" }, applicationRecord, null), false);
  assert.equal(canReadStoredObject({ role: "inspector" }, null, "application-document"), false);
});

test("team photos stay available to staff while orphaned objects fail closed", () => {
  const photoRecord: VerifiedUploadRecord = {
    ...applicationRecord,
    name: "inspection.jpg",
    contentType: "image/jpeg",
    purpose: "staff-photo",
    ownerStaffId: 3,
  };
  assert.equal(canReadStoredObject({ role: "staff" }, photoRecord, null), true);
  assert.equal(canReadStoredObject({ role: "inspector" }, null, "operational-photo"), true);
  assert.equal(canReadStoredObject({ role: "admin" }, null, null), false);
});
