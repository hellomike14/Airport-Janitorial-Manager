import assert from "node:assert/strict";
import test from "node:test";
import {
  contentMatchesClaim,
  createUploadCapabilityToken,
  privateObjectServingPolicy,
  uploadRecordMetadata,
  verifiedUploadRecordFromMetadata,
  verifyUploadCapabilityToken,
  type UploadCapability,
} from "./secureUpload";

process.env.UPLOAD_TOKEN_SECRET = "test-only-upload-capability-secret-32-bytes";

function capability(overrides: Partial<UploadCapability> = {}): UploadCapability {
  return {
    v: 1,
    objectPath: "/objects/uploads/4df7435d-1736-4a1f-9ca2-6887a6ee7773",
    name: "inspection.jpg",
    size: 4,
    contentType: "image/jpeg",
    purpose: "staff-photo",
    ownerStaffId: 17,
    exp: Date.now() + 60_000,
    ...overrides,
  };
}

test("upload capabilities bind path, type, size, purpose, owner, and expiry", () => {
  const claims = capability();
  const token = createUploadCapabilityToken(claims);
  assert.deepEqual(verifyUploadCapabilityToken(token), claims);

  const [payload, signature] = token.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  decoded.size = 5;
  const tamperedPayload = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url");
  assert.equal(verifyUploadCapabilityToken(`${tamperedPayload}.${signature}`), null);
  assert.equal(verifyUploadCapabilityToken(token, claims.exp), null);
});

test("trusted upload records are signed and must match GCS-reported metadata", () => {
  const claims = capability();
  const custom = uploadRecordMetadata(claims);
  const metadata = {
    contentType: claims.contentType,
    size: String(claims.size),
    metadata: custom,
  };
  const record = verifiedUploadRecordFromMetadata(claims.objectPath, metadata);
  assert.equal(record?.purpose, "staff-photo");
  assert.equal(record?.ownerStaffId, 17);
  assert.equal(
    verifiedUploadRecordFromMetadata(claims.objectPath, { ...metadata, size: "5" }),
    null,
  );
  assert.equal(
    verifiedUploadRecordFromMetadata(claims.objectPath, {
      ...metadata,
      metadata: { ...custom, marvoluploadpurpose: "application-document" },
    }),
    null,
  );
});

test("magic-byte checks reject HTML masquerading as an image", () => {
  assert.equal(
    contentMatchesClaim(Buffer.from("<script>alert(1)</script>"), "image/jpeg"),
    false,
  );
  assert.equal(
    contentMatchesClaim(Buffer.from([0xff, 0xd8, 0xff, 0xdb]), "image/jpeg"),
    true,
  );
  assert.equal(
    contentMatchesClaim(Buffer.from("%PDF-1.7\n"), "application/pdf"),
    true,
  );
});

test("private serving is no-store/nosniff and forces documents to download", () => {
  const documentClaims = capability({
    name: "resume\r\nX-Evil: yes.pdf",
    size: 9,
    contentType: "application/pdf",
    purpose: "application-document",
    ownerStaffId: null,
  });
  const custom = uploadRecordMetadata(documentClaims);
  const metadata = {
    contentType: "application/pdf",
    size: "9",
    metadata: custom,
  };
  const record = verifiedUploadRecordFromMetadata(documentClaims.objectPath, metadata);
  const policy = privateObjectServingPolicy(metadata, record);
  assert.ok(policy);
  assert.equal(policy.headers["Cache-Control"], "no-store");
  assert.equal(policy.headers["X-Content-Type-Options"], "nosniff");
  assert.match(policy.headers["Content-Security-Policy"], /sandbox/);
  assert.match(policy.contentDisposition, /^attachment;/);
  assert.doesNotMatch(policy.contentDisposition, /\r|\n|X-Evil:/);

  const imagePolicy = privateObjectServingPolicy(
    { contentType: "image/png", size: "10" },
    null,
  );
  assert.match(imagePolicy?.contentDisposition ?? "", /^inline;/);
});

test("private serving rejects oversized and active MIME metadata", () => {
  assert.equal(
    privateObjectServingPolicy({ contentType: "text/html", size: "100" }, null),
    null,
  );
  assert.equal(
    privateObjectServingPolicy({ contentType: "image/jpeg", size: "12582913" }, null),
    null,
  );
});
