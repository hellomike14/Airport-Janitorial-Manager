import assert from "node:assert/strict";
import test from "node:test";
import { groupInboundEmailReceivedAt, groupInspectorEmailAcceptedAt } from "./messageEmailHistory";

test("provider acceptance timestamp is shown only after all selected recipients were accepted", () => {
  const first = new Date("2026-10-07T20:00:00.000Z");
  const last = new Date("2026-10-07T20:03:00.000Z");
  assert.deepEqual(groupInspectorEmailAcceptedAt([
    { messageId: 1, status: "accepted", acceptedAt: first },
    { messageId: 1, status: "accepted", acceptedAt: last },
    { messageId: 2, status: "accepted", acceptedAt: first },
    { messageId: 2, status: "failed", acceptedAt: null },
    { messageId: 3, status: "accepted", acceptedAt: null },
  ]), new Map([
    [1, "2026-10-07T20:03:00.000Z"],
    [2, null],
    [3, null],
  ]));
  assert.deepEqual(groupInspectorEmailAcceptedAt([]), new Map());
});

test("inbound receipt history uses recorded receipt time and skips unlinked records", () => {
  const first = new Date("2026-10-07T20:47:17.319Z");
  const earlier = new Date("2026-10-07T20:45:00.000Z");
  assert.deepEqual(groupInboundEmailReceivedAt([
    { messageId: 8, receivedAt: first },
    { messageId: 8, receivedAt: earlier },
    { messageId: null, receivedAt: first },
  ]), new Map([[8, "2026-10-07T20:45:00.000Z"]]));
});
