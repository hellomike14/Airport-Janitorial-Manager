import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";

process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://unused:unused@127.0.0.1:5432/unused";

const { isPublicApiRequest } = await import("./requireStaffSession");

function request(method: string, path: string): Pick<Request, "method" | "path"> {
  return { method, path };
}

test("only the signed upload PUT boundary is public", () => {
  assert.equal(
    isPublicApiRequest(request("PUT", "/storage/uploads/opaque.capability")),
    true,
  );
  assert.equal(isPublicApiRequest(request("GET", "/storage/objects/uploads/id")), false);
  assert.equal(isPublicApiRequest(request("PUT", "/storage/objects/uploads/id")), false);
  assert.equal(isPublicApiRequest(request("POST", "/storage/uploads/opaque-capability")), false);
  assert.equal(isPublicApiRequest(request("PUT", "/storage/uploads/not-a-token")), false);
  assert.equal(isPublicApiRequest(request("PUT", "/storage/uploads/a.b/extra")), false);
});

test("only the exact protected escalation sweep path bypasses Clerk", () => {
  assert.equal(
    isPublicApiRequest(
      request("POST", "/tasks/internal/inspector-escalations/sweep"),
    ),
    true,
  );
  assert.equal(
    isPublicApiRequest(
      request("GET", "/tasks/internal/inspector-escalations/sweep"),
    ),
    false,
  );
  assert.equal(
    isPublicApiRequest(request("POST", "/tasks/internal/other")),
    false,
  );
});
