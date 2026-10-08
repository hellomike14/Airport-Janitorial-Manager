import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageReceiptStatus, type ReceiptLabels } from "./MessageReceiptStatus";
import type { ChatMessageReceipt } from "@workspace/api-client-react";

const labels: ReceiptLabels = {
  unconfirmed: "Unconfirmed receipt",
  confirmed: (name, role, time) => `In-app receipt confirmed by ${name} (${role}) · ${time}`,
  scopeNote: "In-app acknowledgment only; not proof of email delivery or every recipient.",
  confirm: "Confirm receipt",
  pending: "Recording receipt confirmation",
  error: "Receipt confirmation could not be saved.",
  historyLabel: "Previous version receipt history",
  earlierVersion: (version, name, role, time) => `Version ${version} confirmed by ${name} (${role}) · ${time}`,
};

const unconfirmed: ChatMessageReceipt = {
  applicable: true,
  direction: "to_inspector",
  status: "unconfirmed",
  version: 2,
  canConfirm: true,
  confirmedBy: null,
  confirmedAt: null,
  previousVersions: [{
    version: 1,
    confirmedBy: { name: "Inspector One", role: "inspector" },
    confirmedAt: "2026-10-01T12:00:00.000Z",
  }],
};

test("receipt UI exposes accessible pending, error, unconfirmed, and prior-version states", () => {
  const markup = renderToStaticMarkup(createElement(MessageReceiptStatus, {
    receipt: unconfirmed,
    pending: true,
    error: true,
    onConfirm: () => {},
    formatTimestamp: (value) => value,
    labels,
  }));

  assert.match(markup, /role="status"/);
  assert.match(markup, /Unconfirmed receipt/);
  assert.match(markup, /Recording receipt confirmation/);
  assert.match(markup, /role="alert"/);
  assert.match(markup, /disabled="" aria-busy="true"/);
  assert.match(markup, /Version 1 confirmed by Inspector One \(inspector\)/);
  assert.match(markup, /not proof of email delivery or every recipient/);
});

test("receipt UI shows confirmer identity and timestamp without an action after confirmation", () => {
  const markup = renderToStaticMarkup(createElement(MessageReceiptStatus, {
    receipt: {
      ...unconfirmed,
      status: "confirmed",
      canConfirm: false,
      confirmedBy: { name: "Manager Two", role: "supervisor" },
      confirmedAt: "2026-10-08T14:30:00.000Z",
    },
    pending: false,
    error: false,
    onConfirm: () => {},
    formatTimestamp: (value) => value,
    labels,
  }));

  assert.match(markup, /In-app receipt confirmed by Manager Two \(supervisor\)/);
  assert.match(markup, /2026-10-08T14:30:00\.000Z/);
  assert.doesNotMatch(markup, /confirm-message-receipt/);
});

test("receipt UI hides itself for messages without inspector-email acknowledgment", () => {
  const markup = renderToStaticMarkup(createElement(MessageReceiptStatus, {
    receipt: {
      applicable: false,
      direction: null,
      status: "not_applicable",
      version: 1,
      canConfirm: false,
      confirmedBy: null,
      confirmedAt: null,
      previousVersions: [],
    },
    pending: false,
    error: false,
    onConfirm: () => {},
    formatTimestamp: (value) => value,
    labels,
  }));

  assert.equal(markup, "");
});
