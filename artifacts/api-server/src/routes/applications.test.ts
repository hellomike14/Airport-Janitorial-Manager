import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { db, pool } from "@workspace/db";
import { jobApplicationsTable, objectUploadsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { createApplicationsRouter } from "./applications";
import type { EmploymentEmail } from "../lib/employmentFormEmail";

test("public applicant submit stores private completed answers, attaches every document to Admin mail, and returns only a receipt", async () => {
  const nonce = randomUUID();
  const firstName = `Fixture${nonce.slice(0, 8)}`, lastName = "PrivacyRegression";
  const email = `${nonce}@example.invalid`;
  const uploadToken = randomUUID();
  const sourcePath = `/objects/uploads/fixture-${nonce}`;
  const completedPath = `/objects/uploads/completed/fixture-${nonce}`;
  let copyCalls = 0;
  const sentEmails: EmploymentEmail[] = [];
  const router = createApplicationsRouter({
    copyApplicantSubmissionObject: async path => {
      assert.equal(path, sourcePath);
      copyCalls++;
      return completedPath;
    },
    getObjectMetadata: async path => {
      assert.equal(path, sourcePath);
      return { sizeBytes: 37, contentType: "image/jpeg" };
    },
    readObjectBytes: async (path) => {
      assert.equal(path, completedPath);
      return { bytes: Buffer.from("synthetic identity photo"), sizeBytes: 37, contentType: "image/jpeg" };
    },
    sendEmail: async message => { sentEmails.push(message); },
  });
  const app = express();
  app.use(express.json());
  app.use("/applications", router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/applications`;
  try {
    await db.insert(objectUploadsTable).values({
      objectPath: sourcePath, ownerStaffId: null, purpose: "application_document", taskId: null,
      conversationId: null, issueId: null, areaId: null, applicantToken: uploadToken,
      mimeType: "image/jpeg", sizeBytes: 37,
    });
    const submittedAnswers = {
      firstName, lastName, email, phone: "synthetic-only", positionApplied: "fixture",
      application: { applicantSignature: "synthetic signature" },
      i9Employee: { identityDocument: "synthetic only" },
      w4Employee: { filingStatus: "fixture" },
      documents: [{ name: "synthetic-id.jpg", path: sourcePath, contentType: "image/jpeg", uploadToken }],
    };
    const response = await fetch(base, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submittedAnswers),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { success: true, emailSent: true });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(copyCalls, 1);

    const [stored] = await db.select().from(jobApplicationsTable).where(and(
      eq(jobApplicationsTable.firstName, firstName), eq(jobApplicationsTable.lastName, lastName),
    ));
    assert.ok(stored, "the completed application is retained for Admin review");
    assert.equal(stored.email, email);
    assert.equal(stored.emailStatus, "sent");
    assert.deepEqual(stored.application, submittedAnswers.application);
    assert.deepEqual(stored.i9Employee, submittedAnswers.i9Employee);
    assert.deepEqual(stored.w4Employee, submittedAnswers.w4Employee);
    assert.deepEqual(stored.documents.map(doc => doc.path), [completedPath]);
    assert.equal(sentEmails.length, 1);
    const sentEmail = sentEmails[0]!;
    assert.match(sentEmail.text, /Job application:/);
    assert.match(sentEmail.text, /Form I-9 \(employee section\):/);
    assert.match(sentEmail.text, /Form W-4 \(employee section\):/);
    assert.equal(sentEmail.attachments.length, 1);
    assert.equal(sentEmail.attachments[0]?.filename, "synthetic-id.jpg");

    const [draft] = await db.select().from(objectUploadsTable).where(eq(objectUploadsTable.objectPath, sourcePath));
    const [snapshot] = await db.select().from(objectUploadsTable).where(eq(objectUploadsTable.objectPath, completedPath));
    assert.ok(draft?.claimedAt, "the draft upload token is consumed on submission");
    assert.equal(snapshot?.purpose, "application_document");
    assert.ok(snapshot?.claimedAt, "the private completed-file snapshot is marked claimed");
    assert.equal(snapshot?.applicantToken, null, "the completed object has no applicant upload capability");

  } finally {
    await db.delete(jobApplicationsTable).where(and(
      eq(jobApplicationsTable.firstName, firstName), eq(jobApplicationsTable.lastName, lastName),
    ));
    await db.delete(objectUploadsTable).where(eq(objectUploadsTable.objectPath, sourcePath));
    await db.delete(objectUploadsTable).where(eq(objectUploadsTable.objectPath, completedPath));
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end();
  }
});
