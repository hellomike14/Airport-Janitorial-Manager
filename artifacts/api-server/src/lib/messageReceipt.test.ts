import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMessageReceiptView,
  canConfirmMessageReceipt,
  getMessageReceiptDirection,
  hashMessageBody,
  type MessageReceiptActor,
  type MessageReceiptFacts,
} from "./messageReceipt";

const inspector: MessageReceiptActor = {
  id: 10,
  name: "Test Inspector",
  role: "inspector",
  active: true,
  loginEnabled: true,
  formerEmployee: false,
};
const manager: MessageReceiptActor = {
  id: 1,
  name: "Test Admin",
  role: "admin",
  active: true,
  loginEnabled: true,
  formerEmployee: false,
};
const outbound: MessageReceiptFacts = {
  messageId: 201,
  conversationId: 101,
  senderId: 1,
  senderRole: "admin",
  body: "Current message text",
  version: 1,
  inspectorId: 10,
  hasOutboundEmail: true,
  hasInboundEmail: false,
};
const inbound: MessageReceiptFacts = {
  ...outbound,
  messageId: 203,
  conversationId: 103,
  senderId: 10,
  senderRole: "inspector",
  hasOutboundEmail: false,
  hasInboundEmail: true,
};

test("receipt direction distinguishes outgoing and authenticated inbound inspector email", () => {
  assert.equal(getMessageReceiptDirection(outbound), "to_inspector");
  assert.equal(getMessageReceiptDirection(inbound), "from_inspector");
  assert.equal(getMessageReceiptDirection({ ...outbound, hasOutboundEmail: false }), null);
  assert.equal(getMessageReceiptDirection({ ...inbound, senderId: 1 }), null);
  assert.equal(getMessageReceiptDirection({ ...outbound, inspectorId: null }), null);
});

test("only the designated active inspector or an active manager can confirm the correct direction", () => {
  assert.equal(canConfirmMessageReceipt(inspector, outbound, "to_inspector"), true);
  assert.equal(canConfirmMessageReceipt(manager, inbound, "from_inspector"), true);
  assert.equal(canConfirmMessageReceipt(manager, outbound, "to_inspector"), false);
  assert.equal(canConfirmMessageReceipt(inspector, inbound, "from_inspector"), false);
  assert.equal(canConfirmMessageReceipt({ ...manager, role: "staff" }, inbound, "from_inspector"), false);
  assert.equal(canConfirmMessageReceipt({ ...inspector, id: 11 }, outbound, "to_inspector"), false);
  assert.equal(canConfirmMessageReceipt({ ...manager, id: 10 }, outbound, "to_inspector"), false);
  assert.equal(canConfirmMessageReceipt({ ...inspector, active: false }, outbound, "to_inspector"), false);
  assert.equal(canConfirmMessageReceipt({ ...inspector, loginEnabled: false }, outbound, "to_inspector"), false);
  assert.equal(canConfirmMessageReceipt({ ...manager, formerEmployee: true }, inbound, "from_inspector"), false);
  assert.equal(canConfirmMessageReceipt(manager, inbound, null), false);
});

test("editing creates a new unconfirmed version while preserving earlier receipt evidence", () => {
  const bodySha256 = hashMessageBody(outbound.body);
  const initial = buildMessageReceiptView(outbound, [{
    messageVersion: 1,
    bodySha256,
    confirmedByName: inspector.name,
    confirmedByRole: inspector.role,
    confirmedAt: new Date("2026-10-01T12:00:00.000Z"),
  }], inspector);
  assert.equal(initial.status, "confirmed");
  assert.equal(initial.canConfirm, false);

  const edited = buildMessageReceiptView({ ...outbound, body: "Edited message text", version: 2 }, [{
    messageVersion: 1,
    bodySha256,
    confirmedByName: inspector.name,
    confirmedByRole: inspector.role,
    confirmedAt: new Date("2026-10-01T12:00:00.000Z"),
  }], inspector);
  assert.equal(edited.status, "unconfirmed");
  assert.equal(edited.canConfirm, true);
  assert.deepEqual(edited.previousVersions, [{
    version: 1,
    confirmedBy: { name: "Test Inspector", role: "inspector" },
    confirmedAt: "2026-10-01T12:00:00.000Z",
  }]);
  assert.notEqual(hashMessageBody(outbound.body), hashMessageBody("Edited message text"));
});
