import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInspectorRequestEmail,
  notificationRecipients,
  sendInspectorRequestEmail,
} from "./inspectorRequestEmail";

test("uses Marcell's address only as the default notification recipient", () => {
  assert.deepEqual(notificationRecipients({}), ["msutherland@marvolenterprises.com"]);
});

test("normalizes, deduplicates, and permits disabling recipients", () => {
  assert.deepEqual(
    notificationRecipients({
      INSPECTOR_REQUEST_NOTIFY_EMAILS:
        " ALERTS@example.com,alerts@example.com, second@example.com ",
    }),
    ["alerts@example.com", "second@example.com"],
  );
  assert.deepEqual(notificationRecipients({ INSPECTOR_REQUEST_NOTIFY_EMAILS: "" }), []);
});

test("builds a plain-text inspector-request notification", () => {
  const email = buildInspectorRequestEmail({
    requesterName: "MCO\nInspector",
    areaName: "Terminal A\r\nEast",
    requestedDate: "2026-09-02",
    details: "Deep clean the elevator lobby.",
    appUrl: "https://airport-janitorial-manager.replit.app/",
  });

  assert.equal(email.subject, "[Inspector Request] Terminal A East");
  assert.match(email.body, /Requested by: MCO Inspector/);
  assert.match(email.body, /Deep clean the elevator lobby\./);
  assert.match(
    email.body,
    /https:\/\/airport-janitorial-manager\.replit\.app\/special-requests/,
  );
});

test("reports missing Microsoft Graph configuration without making a request", async () => {
  const result = await sendInspectorRequestEmail(
    {
      requesterName: "Inspector",
      areaName: "Terminal C",
      requestedDate: "2026-09-02",
      details: "Test request",
    },
    { INSPECTOR_REQUEST_NOTIFY_EMAILS: "msutherland@marvolenterprises.com" },
  );

  assert.deepEqual(result, { status: "not_configured", recipientCount: 1 });
});
