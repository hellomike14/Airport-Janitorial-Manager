import assert from "node:assert/strict";
import test from "node:test";
import express, { type RequestHandler } from "express";
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
  const pdfUploadToken = randomUUID();
  const pdfSourcePath = `/objects/uploads/fixture-pdf-${nonce}`;
  const pdfCompletedPath = `/objects/uploads/completed-pdf-${nonce}`;
  const photoBytes = Buffer.from("synthetic identity photo");
  const pdfBytes = Buffer.from("%PDF-1.7\nsynthetic uploaded application PDF");
  const storedFiles = new Map([
    [completedPath, { bytes: photoBytes, contentType: "image/jpeg" }],
    [pdfCompletedPath, { bytes: pdfBytes, contentType: "application/pdf" }],
  ]);
  let copyCalls = 0;
  const sentEmails: EmploymentEmail[] = [];
  const router = createApplicationsRouter({
    copyApplicantSubmissionObject: async path => {
      copyCalls++;
      if (path === sourcePath) return completedPath;
      if (path === pdfSourcePath) return pdfCompletedPath;
      assert.fail(`Unexpected source path: ${path}`);
    },
    getObjectMetadata: async path => {
      if (path === sourcePath) return { sizeBytes: photoBytes.byteLength, contentType: "image/jpeg" };
      if (path === pdfSourcePath) return { sizeBytes: pdfBytes.byteLength, contentType: "application/pdf" };
      assert.fail(`Unexpected upload metadata path: ${path}`);
    },
    readObjectBytes: async (path) => {
      const file = storedFiles.get(path);
      assert.ok(file, `Unexpected object read path: ${path}`);
      return { ...file, sizeBytes: file.bytes.byteLength };
    },
    sendEmail: async message => { sentEmails.push(message); },
    authorizeAdmin: ((req, res, next) => {
      const role = req.headers["x-test-role"];
      if (role === "admin") next();
      else res.status(role ? 403 : 401).end();
    }) satisfies RequestHandler,
  });
  const app = express();
  app.use(express.json());
  app.use("/applications", router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/applications`;
  try {
    await db.insert(objectUploadsTable).values([
      {
        objectPath: sourcePath, ownerStaffId: null, purpose: "application_document", taskId: null,
        conversationId: null, issueId: null, areaId: null, applicantToken: uploadToken,
        mimeType: "image/jpeg", sizeBytes: photoBytes.byteLength,
      },
      {
        objectPath: pdfSourcePath, ownerStaffId: null, purpose: "application_document", taskId: null,
        conversationId: null, issueId: null, areaId: null, applicantToken: pdfUploadToken,
        mimeType: "application/pdf", sizeBytes: pdfBytes.byteLength,
      },
    ]);
    const submittedAnswers = {
      firstName, lastName, email, phone: "synthetic-only", positionApplied: "fixture",
      application: { applicantSignature: "synthetic signature" },
      i9Employee: { identityDocument: "synthetic only" },
      w4Employee: { filingStatus: "fixture" },
      documents: [
        { name: "synthetic-upload.pdf", path: pdfSourcePath, contentType: "application/pdf", uploadToken: pdfUploadToken },
        { name: "synthetic-id.jpg", path: sourcePath, contentType: "image/jpeg", uploadToken },
      ],
    };
    const response = await fetch(base, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submittedAnswers),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { success: true, emailSent: true });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(copyCalls, 2);

    const [stored] = await db.select().from(jobApplicationsTable).where(and(
      eq(jobApplicationsTable.firstName, firstName), eq(jobApplicationsTable.lastName, lastName),
    ));
    assert.ok(stored, "the completed application is retained for Admin review");
    assert.equal(stored.email, email);
    assert.equal(stored.emailStatus, "sent");
    assert.deepEqual(stored.application, submittedAnswers.application);
    assert.deepEqual(stored.i9Employee, submittedAnswers.i9Employee);
    assert.deepEqual(stored.w4Employee, submittedAnswers.w4Employee);
    assert.deepEqual(stored.documents.map(doc => doc.path), [pdfCompletedPath, completedPath]);
    assert.equal(sentEmails.length, 1);
    const sentEmail = sentEmails[0]!;
    assert.match(sentEmail.text, /Job application:/);
    assert.match(sentEmail.text, /Form I-9 \(employee section\):/);
    assert.match(sentEmail.text, /Form W-4 \(employee section\):/);
    assert.equal(sentEmail.attachments.length, 2);
    assert.equal(sentEmail.attachments[0]?.filename, "synthetic-upload.pdf");
    assert.equal(sentEmail.attachments[1]?.filename, "synthetic-id.jpg");

    const anonymousPdf = await fetch(`${base}/${stored.id}/pdf`);
    assert.equal(anonymousPdf.status, 401);
    const staffPdf = await fetch(`${base}/${stored.id}/pdf`, { headers: { "x-test-role": "staff" } });
    assert.equal(staffPdf.status, 403);
    const applicationPdf = await fetch(`${base}/${stored.id}/pdf`, { headers: { "x-test-role": "admin" } });
    assert.equal(applicationPdf.status, 200);
    assert.equal(applicationPdf.headers.get("content-type"), "application/pdf");
    assert.equal(applicationPdf.headers.get("cache-control"), "private, no-store");
    assert.ok(Buffer.from(await applicationPdf.arrayBuffer()).subarray(0, 5).equals(Buffer.from("%PDF-")));

    const emailApplication = (role: string, body: unknown) => fetch(`${base}/${stored.id}/email-pdf`, {
      method: "POST",
      headers: { "x-test-role": role, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal((await emailApplication("staff", { recipientEmail: "recipient@example.invalid" })).status, 403);
    assert.equal((await emailApplication("admin", {
      recipientEmail: "recipient@example.invalid",
      attachment: "client-supplied-content-must-be-rejected",
    })).status, 400);
    const applicationEmail = await emailApplication("admin", { recipientEmail: "recipient@example.invalid" });
    assert.equal(applicationEmail.status, 202);
    assert.deepEqual(await applicationEmail.json(), { accepted: true });
    assert.equal(sentEmails[1]?.to, "recipient@example.invalid");
    assert.equal(sentEmails[1]?.attachments.length, 1);
    assert.equal(sentEmails[1]?.attachments[0]?.contentType, "application/pdf");
    assert.ok(sentEmails[1]?.attachments[0]?.bytes.subarray(0, 5).equals(Buffer.from("%PDF-")));

    const emailDocument = (index: number) => fetch(`${base}/${stored.id}/documents/${index}/email`, {
      method: "POST",
      headers: { "x-test-role": "admin", "content-type": "application/json" },
      body: JSON.stringify({ recipientEmail: "recipient@example.invalid" }),
    });
    const documentEmail = await emailDocument(0);
    assert.equal(documentEmail.status, 202);
    assert.deepEqual(await documentEmail.json(), { accepted: true });
    assert.deepEqual(sentEmails[2]?.attachments[0]?.bytes, pdfBytes);
    assert.equal((await emailDocument(1)).status, 415);
    assert.equal(sentEmails.length, 3);

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
    await db.delete(objectUploadsTable).where(eq(objectUploadsTable.objectPath, pdfSourcePath));
    await db.delete(objectUploadsTable).where(eq(objectUploadsTable.objectPath, completedPath));
    await db.delete(objectUploadsTable).where(eq(objectUploadsTable.objectPath, pdfCompletedPath));
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end();
  }
});
