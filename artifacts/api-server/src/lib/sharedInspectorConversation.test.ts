import assert from "node:assert/strict";
import test from "node:test";
import { sharedInspector, canReadSharedInspector, canonicalSharedInspectorThread, groupSharedInspectorThreads, sharedInspectorGroupIsArchived, sharedMessageIsRead } from "./sharedInspectorConversation";

const inspector = { id: 10, role: "inspector", email: " Inspector@MarvolEnterprises.com " };
const originalManager = { id: 20, role: "supervisor" };
const thread = { id: 1, isGroup: false, participantAId: 20, participantBId: 10 };
const people = [inspector, originalManager];

for (const role of ["admin", "supervisor"]) {
  test(`${role} outside the original pair can access shared inspector history`, () => {
    const actor = { id: 30, role, active: true, loginEnabled: true, formerEmployee: false };
    assert.equal(canReadSharedInspector(actor, thread, people), true);
    assert.equal(canReadSharedInspector(actor, { ...thread, participantAId: 10, participantBId: 20 }, people), true);
    assert.equal(canReadSharedInspector({ ...actor, active: false }, thread, people), false);
    assert.equal(canReadSharedInspector({ ...actor, loginEnabled: false }, thread, people), false);
    assert.equal(canReadSharedInspector({ ...actor, formerEmployee: true }, thread, people), false);
  });
}

test("ordinary DMs, groups, and other inspector identities remain private", () => {
  assert.equal(sharedInspector({ ...thread, isGroup: true }, people), undefined);
  assert.equal(sharedInspector(thread, [{ ...inspector, email: "another@example.com" }, originalManager]), undefined);
  assert.equal(sharedInspector(thread, [{ ...inspector, role: "staff" }, originalManager]), undefined);
  assert.equal(sharedInspector(thread, [inspector, { ...originalManager, role: "staff" }]), undefined);
  assert.equal(sharedInspector(thread, []), undefined);
});

test("shared inspector threads group into one canonical view without absorbing ordinary DMs", () => {
  const secondThread = { ...thread, id: 3, participantAId: 30, participantBId: 10 };
  const ordinary = { ...thread, id: 4, participantAId: 40 };
  const people = [
    inspector,
    originalManager,
    { id: 30, role: "admin", email: "manager@example.com", active: true, loginEnabled: true, formerEmployee: false },
    { id: 40, role: "staff" },
  ];
  const groups = groupSharedInspectorThreads([thread, secondThread, ordinary], people);
  assert.deepEqual(groups.get(inspector.id)?.map(({ id }) => id), [1, 3]);
  assert.equal(canonicalSharedInspectorThread([thread, secondThread], people)?.id, 3);
  assert.equal(groups.size, 1);
  assert.equal(sharedInspectorGroupIsArchived([1, 3], new Set([1])), false);
  assert.equal(sharedInspectorGroupIsArchived([1, 3], new Set([1, 3])), true);
});

test("worker, inspector, and unknown roles cannot inherit management access", () => {
  for (const role of ["staff", "inspector", "unknown"]) {
    assert.equal(canReadSharedInspector({ id: 30, role, active: true, loginEnabled: true, formerEmployee: false }, thread, people), false);
  }
});

test("one manager reading a reply does not clear another manager's unread state", () => {
  const message = { senderId: 10, createdAt: new Date("2026-09-10T14:00:00Z") };
  assert.equal(sharedMessageIsRead(message, 20, new Date("2026-09-10T14:01:00Z")), true);
  assert.equal(sharedMessageIsRead(message, 30, null), false);
  assert.equal(sharedMessageIsRead(message, 30, new Date("2026-09-10T13:59:00Z")), false);
  assert.equal(sharedMessageIsRead(message, 30, message.createdAt), true);
  assert.equal(sharedMessageIsRead(message, 10, null), true);
});
