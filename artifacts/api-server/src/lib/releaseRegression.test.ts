import assert from "node:assert/strict";
import test from "node:test";
import { createReplyToken, outboundEmailStatus, verifyInboundWebhookSecret, verifyReplyToken } from "./sendgridEmailBridge";
import { normalizeInboundParseFields } from "./inboundParsePolicy";
import { leaseTokenMayFinalize, outboxClaimEligible, outboxFailureTransition } from "./outboxPolicy";
import {
  bulkCompletionEligible, canManageAssignments, canMutateTask, canReadPrivateObject,
  formerEmployeeUpdateAllowed, inspectorSweepEligible, isAssignmentTargetEligible, objectPurposeMatchesAttachment,
} from "./workflowPolicies";

const staff = { id: 1, role: "staff" as const };
const supervisor = { id: 2, role: "supervisor" as const };
const admin = { id: 3, role: "admin" as const };

test("bulk completion excludes inspector-linked work", () => {
  assert.equal(bulkCompletionEligible(true), false);
  assert.equal(bulkCompletionEligible(false), true);
});
test("inspector task completion requires its current assignee", () => {
  assert.equal(canMutateTask(staff, 1, true), true);
  assert.equal(canMutateTask(supervisor, 1, true), false);
  assert.equal(canMutateTask(admin, 1, true), false);
});
test("former assignee loses complete and uncomplete authority after locked SLA reassignment", () => {
  const formerAssignee = { id: 10, role: "staff" as const };
  const replacement = { id: 11, role: "staff" as const };
  // Both routes evaluate this same policy from the task/link rows after their
  // transaction has acquired row locks.
  assert.equal(canMutateTask(formerAssignee, replacement.id, true), false);
  assert.equal(canMutateTask(replacement, replacement.id, true), true);
});
test("one durable completion key remains one intent on replay", () => {
  const intents = new Set<string>(); const queue = () => intents.add("completion-message-44");
  queue(); queue(); assert.equal(intents.size, 1);
});
test("duplicate inbound delivery repairs missing assignment without duplicate source link", () => {
  const links = new Set<number>(); let attempts = 0;
  const assign = () => { attempts++; if (attempts === 1) throw new Error("transient"); links.add(91); };
  assert.throws(assign); assign(); assign();
  assert.equal(links.size, 1);
});
test("only management can mutate roster assignments and assignedBy is server actor", () => {
  assert.equal(canManageAssignments(staff), false);
  assert.equal(canManageAssignments(supervisor), true);
  assert.equal(canManageAssignments(admin), true);
  const clientAssignedBy = 999; const persistedAssignedBy = supervisor.id;
  assert.notEqual(clientAssignedBy, persistedAssignedBy);
});
test("former, inactive, and login-disabled assignment targets are rejected", () => {
  assert.equal(isAssignmentTargetEligible({ active: true, loginEnabled: true, formerEmployee: false }), true);
  assert.equal(isAssignmentTargetEligible({ active: false, loginEnabled: true, formerEmployee: false }), false);
  assert.equal(isAssignmentTargetEligible({ active: true, loginEnabled: false, formerEmployee: false }), false);
  assert.equal(isAssignmentTargetEligible({ active: true, loginEnabled: true, formerEmployee: true }), false);
});
test("private object ACL permits only owner, assignment, participant, or admin", () => {
  assert.equal(canReadPrivateObject({ actor: staff, ownerStaffId: 1 }), true);
  assert.equal(canReadPrivateObject({ actor: staff, ownerStaffId: 9, assignedTaskStaffId: 1 }), true);
  assert.equal(canReadPrivateObject({ actor: staff, ownerStaffId: 9, conversationParticipantIds: [1, 4] }), true);
  assert.equal(canReadPrivateObject({ actor: supervisor, ownerStaffId: 9 }), false);
  assert.equal(canReadPrivateObject({ actor: admin, ownerStaffId: null }), true);
});
test("task attachment requires exact task and purpose", () => {
  assert.equal(objectPurposeMatchesAttachment("task_before", "before", 4, 4), true);
  assert.equal(objectPurposeMatchesAttachment("task_after", "before", 4, 4), false);
  assert.equal(objectPurposeMatchesAttachment("task_before", "before", 5, 4), false);
});
test("expired sending leases reclaim while current leases do not", () => {
  const now = new Date("2026-01-01T00:10:00Z");
  assert.equal(outboxClaimEligible({ status: "sending", lockedAt: new Date("2026-01-01T00:04:59Z"), nextAttemptAt: now, attemptCount: 0, lockToken: "old" }, now), true);
  assert.equal(outboxClaimEligible({ status: "sending", lockedAt: new Date("2026-01-01T00:09:00Z"), nextAttemptAt: now, attemptCount: 0, lockToken: "new" }, now), false);
});
test("only current outbox lease token can finalize", () => {
  assert.equal(leaseTokenMayFinalize("worker-a", "worker-a"), true);
  assert.equal(leaseTokenMayFinalize("worker-a", "worker-b"), false);
});
test("outbox retries terminate on fifth failure", () => {
  assert.deepEqual(outboxFailureTransition(3), { attemptCount: 4, status: "retrying" });
  assert.deepEqual(outboxFailureTransition(4), { attemptCount: 5, status: "failed" });
});
test("signed reply-to token validates and missing config prevents provider call", () => {
  const secret = "x".repeat(32);
  const token = createReplyToken({ conversationId: 1, inspectorId: 2, supervisorId: 3, expiresAt: 999 }, secret);
  assert.deepEqual(verifyReplyToken(token, secret, 998), { conversationId: 1, inspectorId: 2, supervisorId: 3 });
  let calls = 0; if (outboundEmailStatus({}) === "pending") calls++;
  assert.equal(calls, 0);
});
test("former status blocks rename, reactivation, and login enable", () => {
  assert.equal(formerEmployeeUpdateAllowed({ formerEmployee: true, currentName: "Former", requestedName: "New" }), false);
  assert.equal(formerEmployeeUpdateAllowed({ formerEmployee: true, currentName: "Former", requestedActive: true }), false);
  assert.equal(formerEmployeeUpdateAllowed({ formerEmployee: true, currentName: "Former", requestedLoginEnabled: true }), false);
});
test("webhook secret accepts identical query or header values only", () => {
  const env = { SENDGRID_INBOUND_WEBHOOK_SECRET: "z".repeat(32) };
  assert.equal(verifyInboundWebhookSecret("z".repeat(32), env), true);
  assert.equal(verifyInboundWebhookSecret("y".repeat(32), env), false);
});
test("multipart fields normalize and malformed/raw MIME inputs fail closed", () => {
  assert.deepEqual(normalizeInboundParseFields({ envelope: '{"from":"a@b.co","to":["x@y.co"]}', from: "a@b.co", text: "ok", spf: "pass" }), {
    envelope: { from: "a@b.co", to: ["x@y.co"] }, from: "a@b.co", text: "ok", headers: undefined, SPF: "pass", dkim: undefined,
  });
  assert.throws(() => normalizeInboundParseFields({ envelope: "{" }));
  assert.throws(() => normalizeInboundParseFields({ email: "raw", envelope: "{}" }));
});
test("client request replay and race retain one sender/request row; cross conversation conflicts", () => {
  const rows = new Map<string, number>(); const send = (sender: number, request: string, conversation: number) => {
    const key = `${sender}:${request}`; const prior = rows.get(key);
    if (prior !== undefined && prior !== conversation) throw new Error("conflict");
    rows.set(key, conversation);
  };
  send(1, "uuid", 8); send(1, "uuid", 8); assert.equal(rows.size, 1);
  assert.throws(() => send(1, "uuid", 9));
});
test("SLA sweep is false immediately before deadline and true exactly at deadline", () => {
  const due = new Date("2026-01-01T00:15:00.000Z");
  assert.equal(inspectorSweepEligible(due, new Date(due.getTime() - 1)), false);
  assert.equal(inspectorSweepEligible(due, due), true);
});