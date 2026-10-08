import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import { ConfidentialError, type ConfidentialIdentity } from "../lib/confidentialAccess";
import { createConfidentialAreasMiddleware } from "./confidentialAreas";

const applicationObject = "/objects/uploads/completed/fixture-photo";

test("blank templates and applicant submission stay public; all completed submission data needs an Admin grant", async () => {
  const app = express();
  app.use(express.json());
  app.use(createConfidentialAreasMiddleware({
    // Deliberately injected only in this test; production derives role/session from verified Clerk.
    resolveIdentity: async req => {
      const role = req.get("x-test-role");
      if (!role) return null;
      return { staffId: 1, sessionId: `fixture-session-${role}`, role } as ConfidentialIdentity;
    },
    requireUnlocked: async (identity, token) => {
      // In tests this header stands in for a valid server grant; production validates its HttpOnly cookie.
      if (identity.role === "admin" && token === "a".repeat(64)) return;
      throw new ConfidentialError(423, "CONFIDENTIAL_LOCKED", "Access code required.");
    },
    isApplicationDocument: async path => path === applicationObject,
  }));
  app.get("/employment-forms/:id", (_req, res) => res.type("application/pdf").send(Buffer.from("%PDF-blank")));
  app.get("/applications", (_req, res) => res.json([{ email: "synthetic-only", application: { private: true } }]));
  app.get("/applications/:id", (_req, res) => res.json({ i9Employee: { private: true }, documents: [applicationObject] }));
  app.patch("/applications/:id", (_req, res) => res.json({ private: true }));
  app.get("/employment-form-submissions", (_req, res) => res.json([{ firstName: "Private", emailStatus: "sent" }]));
  app.get("/employment-form-submissions/:id", (_req, res) => res.json({ completedPdfPath: applicationObject }));
  app.post("/employment-form-submissions", (_req, res) => res.status(201).json({ success: true, emailSent: true }));
  app.get("/storage/objects/uploads/completed/fixture-photo", (_req, res) => res.send("private photo"));
  app.post("/applications", (_req, res) => res.status(201).json({ success: true }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const get = (path: string, role?: string, unlocked = false) => fetch(`${base}${path}`, {
    headers: { ...(role ? { "x-test-role": role } : {}), ...(unlocked ? { cookie: `marvol_confidential=${"a".repeat(64)}` } : {}) },
  });
  try {
    for (const path of ["/employment-forms/job-application", "/employment-forms/i-9", "/employment-forms/w-4"]) {
      const response = await get(path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type")!, /application\/pdf/);
    }
    for (const formId of [
      "offer-tracking",
      "knowledge-check-guide",
      "independent-work-release",
      "exception-correction",
      "badging-checklist",
      "badge-control",
      "i9-everify-tracker",
    ]) {
      const path = `/employment-forms/${formId}`;
      const anonymous = await get(path);
      assert.equal(anonymous.status, 401, `${formId} blocks anonymous access`);
      assert.equal(anonymous.headers.get("cache-control"), "private, no-store");
      assert.equal((await get(path, "staff")).status, 403, `${formId} blocks non-Admin access`);
      assert.equal((await get(path, "admin")).status, 423, `${formId} requires the confidential access code`);
      const unlocked = await get(path, "admin", true);
      assert.equal(unlocked.status, 200, `${formId} opens for an unlocked Admin`);
      assert.match(unlocked.headers.get("content-type")!, /application\/pdf/);
    }
    assert.deepEqual(await (await fetch(`${base}/applications`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ firstName: "Public applicant" }) })).json(), { success: true });
    assert.deepEqual(await (await fetch(`${base}/employment-form-submissions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ firstName: "Public applicant" }) })).json(), { success: true, emailSent: true });
    for (const role of [undefined, "applicant", "staff", "supervisor"]) {
      for (const [method, path] of [
        ["GET", "/applications"], ["GET", "/applications/17"], ["PATCH", "/applications/17"],
        ["GET", "/employment-form-submissions"], ["GET", "/employment-form-submissions/17"],
        ["POST", "/employment-form-submissions/17/resend-email"],
        ["GET", "/storage/objects/uploads/completed/fixture-photo"],
      ] as const) {
        const response = await fetch(`${base}${path}`, { method, headers: role ? { "x-test-role": role } : {} });
        assert.ok(response.status === (role ? 403 : 401), `${role ?? "anonymous"} ${method} ${path}: ${response.status}`);
        if (method === "GET") assert.equal(response.headers.get("cache-control"), "private, no-store");
      }
    }
    assert.equal((await get("/applications", "admin")).status, 423, "an Admin still needs an access-code grant");
    for (const path of [
      "/applications", "/applications/17",
      "/employment-form-submissions", "/employment-form-submissions/17",
      "/storage/objects/uploads/completed/fixture-photo",
    ]) {
      assert.equal((await get(path, "admin", true)).status, 200);
    }
    assert.equal((await get("/employment-form-submissions", "admin")).headers.get("cache-control"), "private, no-store");
    assert.equal((await fetch(`${base}/applications/17`, { method: "PATCH", headers: { "x-test-role": "admin", cookie: `marvol_confidential=${"a".repeat(64)}` } })).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
