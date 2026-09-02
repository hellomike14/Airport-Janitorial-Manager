import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_UPLOAD_BYTES,
  PublicUploadRateLimiter,
  validateUploadMetadata,
} from "./uploadRequestPolicy";

test("upload metadata accepts supported files within the size limit", () => {
  assert.equal(
    validateUploadMetadata({
      name: "inspection.jpg",
      size: 1024,
      contentType: "image/jpeg",
      purpose: "staff-photo",
    }),
    null,
  );
  assert.equal(
    validateUploadMetadata({
      name: "resume.pdf",
      size: MAX_UPLOAD_BYTES,
      contentType: "application/pdf",
      purpose: "application-document",
    }),
    null,
  );
});

test("upload metadata rejects oversized and executable content", () => {
  assert.match(
    validateUploadMetadata({
      name: "huge.jpg",
      size: MAX_UPLOAD_BYTES + 1,
      contentType: "image/jpeg",
      purpose: "staff-photo",
    }) ?? "",
    /File size/,
  );
  assert.equal(
    validateUploadMetadata({
      name: "payload.exe",
      size: 100,
      contentType: "application/x-msdownload",
      purpose: "application-document",
    }),
    "File type is not allowed",
  );
  assert.equal(
    validateUploadMetadata({
      name: "not-a-photo.pdf",
      size: 100,
      contentType: "application/pdf",
      purpose: "staff-photo",
    }),
    "File type is not allowed",
  );
});

test("public upload limiter caps each client and resets its window", () => {
  const limiter = new PublicUploadRateLimiter();
  const now = 10_000;
  for (let index = 0; index < 10; index += 1) {
    assert.deepEqual(limiter.check("203.0.113.1", now), { allowed: true });
  }
  assert.equal(limiter.check("203.0.113.1", now).allowed, false);
  assert.deepEqual(limiter.check("203.0.113.1", now + 10 * 60 * 1000), { allowed: true });
});
