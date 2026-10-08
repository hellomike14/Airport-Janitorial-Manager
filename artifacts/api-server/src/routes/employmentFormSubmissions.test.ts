import assert from "node:assert/strict";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { employmentFormSubmissionsTable, objectUploadsTable } from "@workspace/db/schema";
import { createEmploymentFormSubmissionsRouter } from "./employmentFormSubmissions";
import type { EmploymentEmail } from "../lib/employmentFormEmail";

const testAdminGate: RequestHandler = (req, res, next) => {
  const role = req.headers["x-test-role"];
  if (role === "admin") next();
  else res.status(role ? 403 : 401).end();
};

test("standalone PDF and ID photos are snapshotted privately, emailed, and reduced to a receipt", async () => {
  const nonce = randomUUID();
  const firstName = `Standalone${nonce.slice(0, 8)}`;
  const lastName = "PrivacyRegression";
  const email = `${nonce}@example.invalid`;
  const inputs = [
    { path: `/objects/uploads/form-${nonce}`, token: randomUUID(), name: "completed.pdf", type: "application/pdf", bytes: Buffer.from("%PDF-synthetic") },
    { path: `/objects/uploads/front-${nonce}`, token: randomUUID(), name: "front.jpg", type: "image/jpeg", bytes: Buffer.from("synthetic-front-photo") },
    { path: `/objects/uploads/back-${nonce}`, token: randomUUID(), name: "back.png", type: "image/png", bytes: Buffer.from("synthetic-back-photo") },
  ];
  const snapshots = inputs.map((_, index) => `/objects/uploads/completed-${nonce}-${index}`);
  const fileData = new Map<string, { bytes: Buffer; contentType: string }>();
  inputs.forEach((input, index) => fileData.set(snapshots[index]!, { bytes: input.bytes, contentType: input.type }));
  const sentEmails: EmploymentEmail[] = [];
  const router = createEmploymentFormSubmissionsRouter({
    getObjectMetadata: async path => {
      const input = inputs.find(item => item.path === path);
      if (input) return { sizeBytes: input.bytes.byteLength, contentType: input.type };
      const snapshot = fileData.get(path);
      assert.ok(snapshot, `Unexpected object metadata path: ${path}`);
      return { sizeBytes: snapshot.bytes.byteLength, contentType: snapshot.contentType };
    },
    copyApplicantSubmissionObject: async path => {
      const index = inputs.findIndex(item => item.path === path);
      assert.notEqual(index, -1);
      return snapshots[index]!;
    },
    readObjectBytes: async path => {
      const file = fileData.get(path);
      assert.ok(file);
      return { ...file, sizeBytes: file.bytes.byteLength };
    },
    sendEmail: async message => { sentEmails.push(message); },
    authorizeAdmin: testAdminGate,
  });
  const app = express();
  app.use(express.json());
  app.use("/employment-form-submissions", router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/employment-form-submissions`;
  try {
    await db.insert(objectUploadsTable).values(inputs.map(input => ({
      objectPath: input.path,
      ownerStaffId: null,
      purpose: "application_document" as const,
      taskId: null,
      conversationId: null,
      issueId: null,
      areaId: null,
      applicantToken: input.token,
      mimeType: input.type,
      sizeBytes: input.bytes.byteLength,
    })));
    const response = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        formId: "i-9",
        firstName,
        lastName,
        email,
        phone: "synthetic-only",
        completedPdf: { name: inputs[0]!.name, path: inputs[0]!.path, contentType: inputs[0]!.type, uploadToken: inputs[0]!.token },
        idPhotos: inputs.slice(1).map(input => ({ name: input.name, path: input.path, contentType: input.type, uploadToken: input.token })),
      }),
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const receipt = await response.json();
    assert.deepEqual(receipt, { success: true, emailSent: true });
    assert.equal(JSON.stringify(receipt).includes(email), false);
    assert.equal(sentEmails.length, 1);
    const sentEmail = sentEmails[0]!;
    assert.match(sentEmail.subject, /Form I-9/);
    assert.match(sentEmail.text, /ID-card photos/);
    assert.equal(sentEmail.attachments.length, 3);

    const [saved] = await db.select().from(employmentFormSubmissionsTable).where(and(
      eq(employmentFormSubmissionsTable.firstName, firstName),
      eq(employmentFormSubmissionsTable.lastName, lastName),
    ));
    assert.ok(saved);
    assert.equal(saved.email, email);
    assert.equal(saved.emailStatus, "sent");
    assert.equal(saved.completedPdfPath, snapshots[0]);
    assert.deepEqual(saved.idPhotos.map(photo => photo.path), snapshots.slice(1));

    const emailEndpoint = `${base}/${saved.id}/email-pdf`;
    const postPdfEmail = (role: string | null, body: unknown) => fetch(emailEndpoint, {
      method: "POST",
      headers: {
        ...(role ? { "x-test-role": role } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    assert.equal((await postPdfEmail(null, { recipientEmail: "recipient@example.invalid" })).status, 401);
    assert.equal((await postPdfEmail("staff", { recipientEmail: "recipient@example.invalid" })).status, 403);
    assert.equal((await postPdfEmail("admin", {
      recipientEmail: "recipient@example.invalid",
      attachments: ["client-supplied"],
    })).status, 400);
    assert.equal(sentEmails.length, 1, "rejected callers and extra attachment data never send");

    const emailedPdf = await postPdfEmail("admin", { recipientEmail: "recipient@example.invalid" });
    const emailReceipt = await emailedPdf.text();
    assert.equal(emailedPdf.status, 202, emailReceipt);
    assert.deepEqual(JSON.parse(emailReceipt), { accepted: true });
    assert.equal(emailedPdf.headers.get("cache-control"), "private, no-store");
    assert.equal(sentEmails.length, 2);
    assert.equal(sentEmails[1]?.to, "recipient@example.invalid");
    assert.equal(sentEmails[1]?.attachments.length, 1, "ID photos are never included in manual PDF email");
    assert.equal(sentEmails[1]?.attachments[0]?.contentType, "application/pdf");
    assert.deepEqual(sentEmails[1]?.attachments[0]?.bytes, inputs[0]!.bytes);
    for (let index = 0; index < inputs.length; index++) {
      const [draft] = await db.select().from(objectUploadsTable).where(eq(objectUploadsTable.objectPath, inputs[index]!.path));
      const [snapshot] = await db.select().from(objectUploadsTable).where(eq(objectUploadsTable.objectPath, snapshots[index]!));
      assert.ok(draft?.claimedAt);
      assert.equal(snapshot?.purpose, "application_document");
      assert.equal(snapshot?.applicantToken, null);
      assert.ok(snapshot?.claimedAt);
    }
  } finally {
    await db.delete(employmentFormSubmissionsTable).where(and(
      eq(employmentFormSubmissionsTable.firstName, firstName),
      eq(employmentFormSubmissionsTable.lastName, lastName),
    ));
    for (const path of [...inputs.map(input => input.path), ...snapshots]) {
      await db.delete(objectUploadsTable).where(eq(objectUploadsTable.objectPath, path));
    }
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end();
  }
});
