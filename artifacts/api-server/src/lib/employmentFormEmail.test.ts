import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPLOYMENT_FORMS_RECIPIENT,
  sendEmploymentFormEmailWithConfig,
  type EmploymentEmail,
} from "./employmentFormEmail";

test("completed-form mail always goes to the configured Admin default with private attachments", async () => {
  const message: EmploymentEmail = {
    subject: "Completed Marvol Form I-9",
    text: "Applicant: Example Person",
    attachments: [{
      filename: "../../completed i9.pdf",
      contentType: "application/pdf",
      bytes: Buffer.from("synthetic completed form"),
    }, {
      filename: "id-card.jpg",
      contentType: "image/jpeg",
      bytes: Buffer.from("synthetic ID image"),
    }],
  };
  const requestBodies: Record<string, unknown>[] = [];
  await sendEmploymentFormEmailWithConfig(
    message,
    { SENDGRID_API_KEY: "synthetic-key", SENDGRID_FROM_EMAIL: "sender@marvolenterprises.com" },
    async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(null, { status: 202 });
    },
  );
  assert.equal(requestBodies.length, 1);
  const payload = requestBodies[0] as {
    personalizations: { to: { email: string }[] }[];
    attachments: { filename: string; content: string; type: string }[];
  };
  assert.deepEqual(payload.personalizations[0]?.to, [{ email: EMPLOYMENT_FORMS_RECIPIENT }]);
  assert.equal(payload.attachments.length, 2);
  assert.equal(payload.attachments[0]?.filename, "completed_i9.pdf");
  assert.equal(Buffer.from(payload.attachments[0]!.content, "base64").toString(), "synthetic completed form");
  assert.equal(payload.attachments[1]?.type, "image/jpeg");
});

test("an explicitly supplied recipient is normalized and receives the encoded PDF attachment", async () => {
  const message: EmploymentEmail = {
    to: " Person@Example.COM ",
    subject: "Onboarding protocol",
    text: "Current protocol attached.",
    attachments: [{
      filename: "Marvol_Employee_Onboarding_Protocol_v1.pdf",
      contentType: "application/pdf",
      bytes: Buffer.from("%PDF-1.7\ncurrent protocol"),
    }],
  };
  let payload: {
    personalizations: { to: { email: string }[] }[];
    attachments: { filename: string; content: string; type: string; disposition: string }[];
  } | undefined;
  await sendEmploymentFormEmailWithConfig(
    message,
    { SENDGRID_API_KEY: "synthetic-key", SENDGRID_FROM_EMAIL: "sender@marvolenterprises.com" },
    async (_input, init) => {
      payload = JSON.parse(String(init?.body)) as typeof payload;
      return new Response(null, { status: 202 });
    },
  );
  assert.deepEqual(payload?.personalizations[0]?.to, [{ email: "person@example.com" }]);
  assert.equal(payload?.attachments[0]?.type, "application/pdf");
  assert.equal(payload?.attachments[0]?.disposition, "attachment");
  assert.equal(
    Buffer.from(payload?.attachments[0]?.content ?? "", "base64").toString(),
    "%PDF-1.7\ncurrent protocol",
  );
});

test("mail fails explicitly when SendGrid is not configured or rejects a message", async () => {
  const message: EmploymentEmail = { subject: "Form", text: "test", attachments: [] };
  await assert.rejects(() => sendEmploymentFormEmailWithConfig(message, {}), /EMPLOYMENT_EMAIL_NOT_CONFIGURED/);
  await assert.rejects(
    () => sendEmploymentFormEmailWithConfig(
      { ...message, to: "not-an-email" },
      { SENDGRID_API_KEY: "synthetic-key", SENDGRID_FROM_EMAIL: "sender@marvolenterprises.com" },
      async () => {
        throw new Error("invalid recipient must not reach the provider");
      },
    ),
    /EMPLOYMENT_EMAIL_INVALID_RECIPIENT/,
  );
  await assert.rejects(
    () => sendEmploymentFormEmailWithConfig(
      message,
      { SENDGRID_API_KEY: "synthetic-key", SENDGRID_FROM_EMAIL: "sender@marvolenterprises.com" },
      async () => new Response(null, { status: 503 }),
    ),
    /EMPLOYMENT_EMAIL_REJECTED_503/,
  );
});
