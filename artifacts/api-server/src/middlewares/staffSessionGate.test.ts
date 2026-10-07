import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import { createStaffSessionGate } from "./staffSessionGate";

test("anonymous completed-record denials are no-store, while applicant submissions remain public", async () => {
  const app = express();
  app.use(express.json());
  app.use(createStaffSessionGate(() => false, async () => null));
  app.get("/applications", (_req, res) => res.json([]));
  app.get("/employment-form-submissions/17", (_req, res) => res.json({}));
  app.post("/employment-form-submissions", (_req, res) => res.status(201).json({ success: true }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (const path of ["/applications", "/employment-form-submissions/17"]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    const submission = await fetch(`${base}/employment-form-submissions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstName: "synthetic" }),
    });
    assert.equal(submission.status, 201);
    assert.deepEqual(await submission.json(), { success: true });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
