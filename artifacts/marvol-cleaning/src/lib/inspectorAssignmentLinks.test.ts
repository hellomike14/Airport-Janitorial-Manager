import assert from "node:assert/strict";
import test from "node:test";
import {
  findVisibleConversation,
  inspectorAssignmentHref,
  inspectorReportHref,
  parseInspectorAssignmentTaskId,
  parseInspectorReportLink,
  parseMessagesSourceLink,
  sourceMessageHref,
  sourceMessageMatches,
} from "./inspectorAssignmentLinks";

test("source email links require one positive safe ID for both the visible conversation and message", () => {
  const target = parseMessagesSourceLink("?conversationId=31&messageId=79");
  assert.deepEqual(target, { conversationId: 31, messageId: 79 });
  assert.equal(parseMessagesSourceLink("?conversationId=31"), null);
  assert.equal(parseMessagesSourceLink("?conversationId=31&messageId=0"), null);
  assert.equal(parseMessagesSourceLink("?conversationId=31x&messageId=79"), null);
  assert.equal(parseMessagesSourceLink("?conversationId=31&conversationId=32&messageId=79"), null);
  assert.equal(parseMessagesSourceLink("?conversationId=9007199254740992&messageId=79"), null);
});

test("source email deep links resolve only through visible threads and the exact source message", () => {
  const link = { conversationId: 12, messageId: 92 };
  const visibleThread = { id: 10, conversationIds: [10, 12] };
  assert.equal(findVisibleConversation([visibleThread], link.conversationId), visibleThread);
  assert.equal(findVisibleConversation([{ id: 11, conversationIds: [11] }], link.conversationId), null);
  assert.equal(sourceMessageMatches(link, visibleThread, { id: 92, conversationId: 12 }), true);
  assert.equal(sourceMessageMatches(link, visibleThread, { id: 92, conversationId: 10 }), false);
  assert.equal(sourceMessageMatches(link, visibleThread, { id: 93, conversationId: 12 }), false);
});

test("assignment/report query IDs and date ranges reject malformed values", () => {
  assert.equal(parseInspectorAssignmentTaskId("?assignmentTaskId=24"), 24);
  assert.equal(parseInspectorAssignmentTaskId("?assignmentTaskId=-24"), null);
  assert.equal(parseInspectorAssignmentTaskId("?assignmentTaskId=24&assignmentTaskId=25"), null);
  assert.deepEqual(
    parseInspectorReportLink("?from=2026-05-01&to=2026-05-03&assignmentTaskId=24"),
    { from: "2026-05-01", to: "2026-05-03", assignmentTaskId: 24 },
  );
  assert.deepEqual(
    parseInspectorReportLink("?from=2026-02-30&to=2026-03-01&assignmentTaskId=24"),
    { from: null, to: null, assignmentTaskId: 24 },
  );
});

test("source and assignment links encode IDs and use the source email's Orlando business date", () => {
  assert.equal(sourceMessageHref(12, 92), "/messages?conversationId=12&messageId=92");
  assert.equal(inspectorAssignmentHref(24), "/issues?assignmentTaskId=24");
  assert.equal(inspectorReportHref(24, "2026-05-01T23:30:00.000Z"), "/report?from=2026-05-01&to=2026-05-01&assignmentTaskId=24");
  assert.equal(inspectorReportHref(24, "not-a-date"), null);

  const reportDate = (receivedAt: string) =>
    new URL(inspectorReportHref(24, receivedAt)!, "https://example.test").searchParams.get("from");
  assert.equal(reportDate("2026-03-08T04:59:59.999Z"), "2026-03-07");
  assert.equal(reportDate("2026-03-08T05:00:00.000Z"), "2026-03-08");
  assert.equal(reportDate("2026-03-09T03:59:59.999Z"), "2026-03-08");
  assert.equal(reportDate("2026-03-09T04:00:00.000Z"), "2026-03-09");
  assert.equal(reportDate("2026-11-01T03:59:59.999Z"), "2026-10-31");
  assert.equal(reportDate("2026-11-01T04:00:00.000Z"), "2026-11-01");
  assert.equal(reportDate("2026-11-02T04:59:59.999Z"), "2026-11-01");
  assert.equal(reportDate("2026-11-02T05:00:00.000Z"), "2026-11-02");
});
