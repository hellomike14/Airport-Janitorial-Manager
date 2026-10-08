import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import { createEmploymentFormsRouter } from "./employmentForms";
import type { ObjectStorageService } from "../lib/objectStorage";
import type { EmploymentEmail } from "../lib/employmentFormEmail";

test("application open and download return the unchanged PDF, with explicit failure handling", async () => {
  const pdf = Buffer.from("%PDF-1.7\noriginal fillable document bytes");
  const forms = [
    ["job-application", "/objects/uploads/354716d4-2967-439f-a9f3-ac4bf6ad01e8", "Marvol_Fillable_Job_Application_April_2026.pdf"],
    ["i-9", "/objects/uploads/8a6c3ec0-65c4-4301-8abe-232454503365", "Form_I-9_Fillable.pdf"],
    ["w-4", "/objects/uploads/979c8345-1282-41d9-b526-5295bbb31be7", "Form_W-4_2026_Fillable.pdf"],
  ] as const;
  let expectedPath: string = forms[0][1];
  let authorized = false;
  let reads = 0;
  let unavailable = false;
  const storage: Pick<ObjectStorageService, "getObjectEntityFile" | "getObjectEntityMetadata" | "readObjectEntityBytes"> = {
    async getObjectEntityFile(path) {
      reads++;
      assert.equal(path, expectedPath);
      if (unavailable) throw new Error("Storage unavailable");
      return { download: async () => [pdf] } as unknown as Awaited<ReturnType<ObjectStorageService["getObjectEntityFile"]>>;
    },
    async getObjectEntityMetadata(path) {
      assert.equal(path, expectedPath);
      return { sizeBytes: pdf.byteLength, contentType: "application/pdf" };
    },
    async readObjectEntityBytes(path) {
      assert.equal(path, expectedPath);
      return { bytes: pdf, sizeBytes: pdf.byteLength, contentType: "application/pdf" };
    },
  };
  const app = express();
  app.use(createEmploymentFormsRouter(storage, (_req, res, next) => {
    if (!authorized) { res.status(403).end(); return; }
    next();
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/employment-forms/job-application`;
  const base = `http://127.0.0.1:${port}/employment-forms`;
  try {
    assert.equal((await fetch(url)).status, 403);
    assert.equal(reads, 0, "denied requests must never read the stored PDF");
    authorized = true;
    for (const [id, path, filename] of forms) {
      expectedPath = path;
      for (const [query, disposition] of [["", "inline"], ["?download=1", "attachment"]]) {
        const response = await fetch(`${base}/${id}${query}`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "application/pdf");
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.equal(response.headers.get("content-disposition"), `${disposition}; filename="${filename}"`);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
      }
    }
    assert.equal((await fetch(`${url}?download=bad`)).status, 400);
    assert.equal((await fetch(`${base}/unknown-form`)).status, 404);
    assert.equal((await fetch(`${base}/__proto__`)).status, 404);
    assert.equal(reads, 6, "invalid options and unregistered forms must not read storage");
    unavailable = true;
    expectedPath = forms[0][1];
    assert.equal((await fetch(url)).status, 503);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("blank fillable templates are available without a staff identity or Admin access code", async () => {
  const expected = new Set([
    "/objects/uploads/354716d4-2967-439f-a9f3-ac4bf6ad01e8",
    "/objects/uploads/8a6c3ec0-65c4-4301-8abe-232454503365",
    "/objects/uploads/979c8345-1282-41d9-b526-5295bbb31be7",
  ]);
  const storage: Pick<ObjectStorageService, "getObjectEntityFile" | "getObjectEntityMetadata" | "readObjectEntityBytes"> = {
    async getObjectEntityFile(path) {
      assert.ok(expected.has(path));
      return { download: async () => [Buffer.from("%PDF-blank-fillable")] } as unknown as Awaited<ReturnType<ObjectStorageService["getObjectEntityFile"]>>;
    },
    async getObjectEntityMetadata(path) {
      assert.ok(expected.has(path));
      return { sizeBytes: 19, contentType: "application/pdf" };
    },
    async readObjectEntityBytes(path) {
      assert.ok(expected.has(path));
      const bytes = Buffer.from("%PDF-blank-fillable");
      return { bytes, sizeBytes: bytes.byteLength, contentType: "application/pdf" };
    },
  };
  const app = express();
  app.use(createEmploymentFormsRouter(storage));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/employment-forms`;
  try {
    for (const id of ["job-application", "i-9", "w-4"]) {
      const response = await fetch(`${base}/${id}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/pdf");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from("%PDF-blank-fillable"));
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("email sends only each allowlisted blank PDF and rejects client-supplied attachment data", async () => {
  const pdf = Buffer.from("%PDF-1.7\nsynthetic blank template");
  const forms = [
    ["job-application", "/objects/uploads/354716d4-2967-439f-a9f3-ac4bf6ad01e8", "Marvol_Fillable_Job_Application_April_2026.pdf"],
    ["i-9", "/objects/uploads/8a6c3ec0-65c4-4301-8abe-232454503365", "Form_I-9_Fillable.pdf"],
    ["w-4", "/objects/uploads/979c8345-1282-41d9-b526-5295bbb31be7", "Form_W-4_2026_Fillable.pdf"],
  ] as const;
  const emails: EmploymentEmail[] = [];
  let expectedPath: string = forms[0][1];
  const storage: Pick<ObjectStorageService, "getObjectEntityFile" | "getObjectEntityMetadata" | "readObjectEntityBytes"> = {
    async getObjectEntityFile(path) {
      assert.equal(path, expectedPath);
      return { download: async () => [pdf] } as unknown as Awaited<ReturnType<ObjectStorageService["getObjectEntityFile"]>>;
    },
    async getObjectEntityMetadata(path) {
      assert.equal(path, expectedPath);
      return { sizeBytes: pdf.byteLength, contentType: "application/pdf" };
    },
    async readObjectEntityBytes(path) {
      assert.equal(path, expectedPath);
      return { bytes: pdf, sizeBytes: pdf.byteLength, contentType: "application/pdf" };
    },
  };
  const app = express();
  app.use(express.json());
  app.use(createEmploymentFormsRouter(storage, undefined, async message => { emails.push(message); }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/employment-forms`;
  try {
    for (const [id, path, filename] of forms) {
      expectedPath = path;
      const response = await fetch(`${base}/${id}/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipientEmail: "sample@example.invalid" }),
      });
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { accepted: true });
      assert.equal(emails.at(-1)?.to, "sample@example.invalid");
      assert.equal(emails.at(-1)?.attachments.length, 1);
      assert.equal(emails.at(-1)?.attachments[0]?.filename, filename);
      assert.deepEqual(emails.at(-1)?.attachments[0]?.bytes, pdf);
    }
    const rejected = await fetch(`${base}/job-application/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recipientEmail: "sample@example.invalid",
        url: "https://attacker.invalid/private.pdf",
        attachment: "client-supplied-bytes",
      }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(emails.length, 3);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("public blank form email endpoint limits requests per router and IP", async () => {
  const pdf = Buffer.from("%PDF-1.7\nsynthetic blank");
  const storage: Pick<ObjectStorageService, "getObjectEntityFile" | "getObjectEntityMetadata" | "readObjectEntityBytes"> = {
    async getObjectEntityFile() {
      return { download: async () => [pdf] } as unknown as Awaited<ReturnType<ObjectStorageService["getObjectEntityFile"]>>;
    },
    async getObjectEntityMetadata() {
      return { sizeBytes: pdf.byteLength, contentType: "application/pdf" };
    },
    async readObjectEntityBytes() {
      return { bytes: pdf, sizeBytes: pdf.byteLength, contentType: "application/pdf" };
    },
  };
  let sends = 0;
  const app = express();
  app.use(express.json());
  app.use(createEmploymentFormsRouter(storage, undefined, async () => { sends++; }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/employment-forms/i-9/email`;
  try {
    for (let i = 0; i < 5; i++) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipientEmail: `sample${i}@example.invalid` }),
      });
      assert.equal(response.status, 202);
    }
    const limited = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipientEmail: "sixth@example.invalid" }),
    });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal(sends, 5);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
