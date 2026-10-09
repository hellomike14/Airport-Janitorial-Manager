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

test("candidate session bypass is limited to promoted candidate status, forms, and training routes", async () => {
  const app = express();
  app.use(createStaffSessionGate(
    () => false,
    async () => null,
    async req => req.header("x-test-candidate") === "yes" ? { candidate: true } : null,
  ));
  app.get("/new-hire/status", (_req, res) => res.sendStatus(204));
  app.get("/employee-training/video", (_req, res) => res.sendStatus(204));
  app.get("/employment-forms/:id", (_req, res) => res.sendStatus(204));
  app.get("/applications", (_req, res) => res.sendStatus(204));
  app.get("/employment-form-submissions", (_req, res) => res.sendStatus(204));
  app.get("/operations", (_req, res) => res.sendStatus(204));
  app.post("/employment-forms/:id", (_req, res) => res.sendStatus(204));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const candidateHeaders = { "x-test-candidate": "yes" };
  try {
    for (const path of [
      "/new-hire/status",
      "/employee-training/video",
      "/employment-forms/i-9",
      "/employment-forms/offer-acceptance",
    ]) {
      assert.equal((await fetch(`${base}${path}`, { headers: candidateHeaders })).status, 204, path);
    }
    for (const [path, init] of [
      ["/new-hire/status?extra=1", { headers: candidateHeaders }],
      ["/employment-forms/offer-acceptance?download=1", { headers: candidateHeaders }],
      ["/employment-forms/offer-tracking", { headers: candidateHeaders }],
      ["/employment-forms/job-application?download=1", { headers: candidateHeaders }],
      ["/applications", { headers: candidateHeaders }],
      ["/employment-form-submissions", { headers: candidateHeaders }],
      ["/operations", { headers: candidateHeaders }],
      ["/employment-forms/offer-acceptance", { method: "POST", headers: candidateHeaders }],
    ] as const) {
      assert.equal((await fetch(`${base}${path}`, init)).status, 401, path);
    }
    assert.equal((await fetch(`${base}/employment-forms/job-application`)).status, 204,
      "the exact anonymous applicant template remains public");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
