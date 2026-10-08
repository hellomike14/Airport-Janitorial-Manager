import assert from "node:assert/strict";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { once } from "node:events";
import {
  MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES,
  type EmploymentEmail,
} from "../lib/employmentFormEmail";
import type { ObjectStorageService } from "../lib/objectStorage";
import { createOnboardingProtocolRouter } from "./onboardingProtocol";

const PDF_PATH = "/objects/uploads/61d217bf-00af-4626-bd97-a84405b38a63";
const PDF = Buffer.from("%PDF-1.7\nonboarding protocol");

type LogEntry = { level: string; fields: Record<string, unknown> };
type TestState = {
  unavailable?: boolean;
  sizeBytes?: number;
  emails?: EmploymentEmail[];
  emailFailure?: Error;
  logs?: LogEntry[];
};

function testRoleGate(allowed: string[]): RequestHandler {
  return (req, res, next) => {
    const role = req.headers["x-test-role"];
    if (!role) {
      res.status(401).end();
      return;
    }
    if (!allowed.includes(String(role))) {
      res.status(403).end();
      return;
    }
    next();
  };
}

function createApp(state: TestState = {}) {
  const reads = { metadata: 0, bytes: 0, download: 0 };
  const storage: Pick<
    ObjectStorageService,
    "getObjectEntityFile" | "getObjectEntityMetadata" | "readObjectEntityBytes"
  > = {
    async getObjectEntityFile(path) {
      reads.download++;
      assert.equal(path, PDF_PATH);
      if (state.unavailable) throw new Error("storage unavailable");
      return {
        download: async () => [PDF],
      } as unknown as Awaited<ReturnType<ObjectStorageService["getObjectEntityFile"]>>;
    },
    async getObjectEntityMetadata(path) {
      reads.metadata++;
      assert.equal(path, PDF_PATH);
      if (state.unavailable) throw new Error("storage unavailable");
      return {
        sizeBytes: state.sizeBytes ?? PDF.byteLength,
        contentType: "application/pdf",
      };
    },
    async readObjectEntityBytes(path, maxBytes) {
      reads.bytes++;
      assert.equal(path, PDF_PATH);
      assert.equal(maxBytes, MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES);
      if (state.unavailable) throw new Error("storage unavailable");
      if (PDF.byteLength > maxBytes) throw new Error("stored document too large");
      return { bytes: PDF, sizeBytes: PDF.byteLength, contentType: "application/pdf" };
    },
  };
  const emails = state.emails ?? [];
  const logs = state.logs ?? [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.defineProperty(req, "log", {
      configurable: true,
      value: {
        info(fields: Record<string, unknown>) { logs.push({ level: "info", fields }); },
        error(fields: Record<string, unknown>) { logs.push({ level: "error", fields }); },
      },
    });
    next();
  });
  app.use(createOnboardingProtocolRouter(
    storage,
    testRoleGate(["admin", "supervisor", "staff", "inspector"]),
    testRoleGate(["admin", "supervisor", "staff", "inspector"]),
    async (message) => {
      if (state.emailFailure) throw state.emailFailure;
      emails.push(message);
    },
  ));
  const server = app.listen(0, "127.0.0.1");
  return { app, emails, logs, reads, server };
}

async function withServer<T>(state: TestState, callback: (url: string, context: ReturnType<typeof createApp>) => Promise<T>) {
  const context = createApp(state);
  await once(context.server, "listening");
  const url = `http://127.0.0.1:${(context.server.address() as { port: number }).port}`;
  try {
    return await callback(url, context);
  } finally {
    await new Promise<void>((resolve, reject) =>
      context.server.close(error => error ? reject(error) : resolve()),
    );
  }
}

test("protected protocol download preserves bytes, headers and role access", async () => {
  await withServer({}, async (url, { reads }) => {
    assert.equal((await fetch(`${url}/onboarding-protocol`)).status, 401);
    for (const role of ["admin", "supervisor", "staff", "inspector"]) {
      for (const [query, disposition] of [["", "inline"], ["?download=1", "attachment"]]) {
        const response = await fetch(`${url}/onboarding-protocol${query}`, {
          headers: { "x-test-role": role },
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "application/pdf");
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.match(response.headers.get("content-disposition")!, new RegExp(`^${disposition};`));
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), PDF);
      }
    }
    assert.equal((await fetch(`${url}/onboarding-protocol?download=invalid`, {
      headers: { "x-test-role": "staff" },
    })).status, 400);
    assert.equal(reads.download, 8);
  });
});

test("authorized staff email route validates recipients and attaches only the current protected PDF", async () => {
  const emails: EmploymentEmail[] = [];
  const logs: LogEntry[] = [];
  await withServer({ emails, logs }, async (url, context) => {
    const endpoint = `${url}/onboarding-protocol/email`;
    const post = (role: string | null, body: unknown) => fetch(endpoint, {
      method: "POST",
      headers: {
        ...(role ? { "x-test-role": role } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    assert.equal((await post(null, { recipientEmail: "person@example.com" })).status, 401);
    assert.equal((await post("applicant", { recipientEmail: "person@example.com" })).status, 403);
    assert.equal((await post("staff", { recipientEmail: "not-an-email" })).status, 400);
    assert.equal((await post("staff", {
      recipientEmail: "person@example.com",
      pdf: "client-supplied-content-must-be-rejected",
    })).status, 400);
    assert.equal(emails.length, 0);

    for (const role of ["admin", "supervisor", "staff", "inspector"]) {
      const response = await post(role, { recipientEmail: `${role}@example.invalid` });
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { accepted: true });
    }
    assert.equal(context.reads.metadata, 4);
    assert.equal(context.reads.bytes, 4);
    assert.equal(emails.length, 4);
    assert.equal(emails[0]?.to, "admin@example.invalid");
    assert.equal(emails[0]?.attachments.length, 1);
    assert.equal(emails[0]?.attachments[0]?.filename, "Marvol_Employee_Onboarding_Protocol_v1.pdf");
    assert.equal(emails[0]?.attachments[0]?.contentType, "application/pdf");
    assert.deepEqual(emails[0]?.attachments[0]?.bytes, PDF);
    assert.equal(logs.length, 6);
    assert.deepEqual(logs[0]?.fields, {
      feature: "onboarding_protocol_email",
      outcome: "failed",
      reason: "invalid_request",
    });
    assert.deepEqual(logs[1]?.fields, {
      feature: "onboarding_protocol_email",
      outcome: "failed",
      reason: "invalid_request",
    });
    assert.deepEqual(logs[2]?.fields, {
      feature: "onboarding_protocol_email",
      outcome: "accepted",
      attachmentBytes: PDF.byteLength,
    });
    assert.equal(JSON.stringify(logs).includes("person@example.com"), false);
  });
});

test("email delivery failures are logged safely and never reported as accepted", async () => {
  const logs: LogEntry[] = [];
  await withServer({
    logs,
    emailFailure: new Error("EMPLOYMENT_EMAIL_REJECTED_503 private provider response"),
  }, async (url) => {
    const response = await fetch(`${url}/onboarding-protocol/email`, {
      method: "POST",
      headers: { "x-test-role": "admin", "content-type": "application/json" },
      body: JSON.stringify({ recipientEmail: "person@example.com" }),
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: "The onboarding protocol could not be emailed. Please try again.",
    });
    assert.equal(logs[0]?.level, "error");
    assert.deepEqual(logs[0]?.fields, {
      feature: "onboarding_protocol_email",
      outcome: "failed",
      reason: "provider_rejected",
    });
    assert.equal(JSON.stringify(logs).includes("person@example.com"), false);
    assert.equal(JSON.stringify(logs).includes("private provider response"), false);
  });
});

test("email route refuses oversized or unavailable PDFs without invoking the sender", async () => {
  const emails: EmploymentEmail[] = [];
  await withServer({ sizeBytes: MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES + 1, emails }, async (url, { reads }) => {
    const oversized = await fetch(`${url}/onboarding-protocol/email`, {
      method: "POST",
      headers: { "x-test-role": "admin", "content-type": "application/json" },
      body: JSON.stringify({ recipientEmail: "person@example.com" }),
    });
    assert.equal(oversized.status, 413);
    assert.equal(reads.bytes, 0);
    assert.equal(emails.length, 0);
  });

  await withServer({ unavailable: true, emails }, async (url) => {
    const unavailable = await fetch(`${url}/onboarding-protocol/email`, {
      method: "POST",
      headers: { "x-test-role": "admin", "content-type": "application/json" },
      body: JSON.stringify({ recipientEmail: "person@example.com" }),
    });
    assert.equal(unavailable.status, 503);
    assert.equal(emails.length, 0);
  });
});
