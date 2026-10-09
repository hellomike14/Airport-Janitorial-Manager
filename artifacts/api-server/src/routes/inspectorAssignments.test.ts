import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import {
  createInspectorAssignmentsRouter,
  type InspectorAssignmentReadArgs,
  type InspectorAssignmentRow,
} from "./inspectorAssignments";

const rows: InspectorAssignmentRow[] = [
  {
    taskId: 101, taskName: "Inspect east entry", taskDate: "2026-05-01", completed: false, completedAt: null,
    completedById: null, taskNotes: "Check the door closer", beforeImagePath: "/objects/before/101",
    afterImagePath: null, taskCreatedAt: new Date("2026-05-01T09:05:00.000Z"),
    assignedStaffId: 20, assignedStaffName: "Assigned One", sourceMessageId: 1001, conversationId: 3001,
    inspectorId: 10, supervisorId: 30, sourceBody: "From inspector: inspector@example.test\nSubject: East entry\n\nThe door closer is loose.",
    receivedAt: new Date("2026-05-01T09:00:00.000Z"), dueAt: new Date("2026-05-01T10:00:00.000Z"),
    escalatedAt: null, assignmentMethod: "fresh_gps", assignmentDistanceMeters: 42, areaId: 5, areaName: "East Entry",
    terminal: "A", history: [{
      assignedStaffId: 20, assignedById: 30, event: "assigned", method: "fresh_gps", distanceMeters: 42,
      provenance: "fresh GPS location", createdAt: new Date("2026-05-01T09:05:00.000Z"),
    }],
  },
  {
    taskId: 102, taskName: "Check loading bay", taskDate: "2026-05-02", completed: false, completedAt: null,
    completedById: null, taskNotes: null, beforeImagePath: null, afterImagePath: "/objects/after/102",
    taskCreatedAt: new Date("2026-05-02T08:05:00.000Z"), assignedStaffId: 21, assignedStaffName: "Assigned Two",
    sourceMessageId: 1002, conversationId: 3001, inspectorId: 10, supervisorId: 30,
    sourceBody: "From inspector: inspector@example.test\n\nCheck the loading bay door.",
    receivedAt: new Date("2026-05-02T08:00:00.000Z"), dueAt: new Date("2026-05-02T08:30:00.000Z"),
    escalatedAt: new Date("2026-05-02T08:31:00.000Z"), assignmentMethod: "area_roster_workload",
    assignmentDistanceMeters: null, areaId: 6, areaName: "Loading Bay", terminal: "B", history: [],
  },
  {
    taskId: 103, taskName: "Inspect office", taskDate: "2026-05-03", completed: true,
    completedAt: new Date("2026-05-03T11:00:00.000Z"), completedById: 22, taskNotes: "Task note only",
    beforeImagePath: null, afterImagePath: null, taskCreatedAt: new Date("2026-05-03T10:00:00.000Z"),
    assignedStaffId: 22, assignedStaffName: "Assigned Three", sourceMessageId: 1003, conversationId: 3002,
    inspectorId: 11, supervisorId: 30, sourceBody: "From inspector: other@example.test\nSubject: Office\n\nInspect office.",
    receivedAt: new Date("2026-05-03T10:00:00.000Z"), dueAt: new Date("2026-05-03T10:30:00.000Z"),
    escalatedAt: null, assignmentMethod: "fresh_gps", assignmentDistanceMeters: 18, areaId: 7, areaName: "Office",
    terminal: "C", history: [],
  },
];

test("inspector assignment report endpoint validates dates and enforces actor visibility without mutations", async () => {
  let actor: { id: number; role: "admin" | "supervisor" | "inspector" | "staff" } | null = null;
  const reads: InspectorAssignmentReadArgs[] = [];
  const app = express();
  app.use(createInspectorAssignmentsRouter({
    resolveActor: (async () => actor) as never,
    readRows: async (args) => {
      reads.push(args);
      return rows;
    },
    now: () => new Date("2026-05-01T09:30:00.000Z"),
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/inspector-assignments`;
  try {
    const unauthenticated = await fetch(base);
    assert.equal(unauthenticated.status, 401);
    assert.equal(reads.length, 0);

    actor = { id: 10, role: "inspector" };
    const inspectorResponse = await fetch(`${base}?from=2026-05-01&to=2026-05-02`);
    assert.equal(inspectorResponse.status, 200);
    assert.equal(inspectorResponse.headers.get("cache-control"), "private, no-store");
    const inspectorItems = await inspectorResponse.json() as Array<{
      source: { messageId: number; conversationId: number };
      sourceEmail: { senderEmail: string | null; subject: string | null; body: string | null };
      task: { taskNotes: string | null; beforeImagePath: string | null; afterImagePath: string | null; completedAt: string | null };
      status: string;
      history: Array<{ event: string }>;
    }>;
    assert.deepEqual(inspectorItems.map((item) => item.source.messageId), [1001, 1002]);
    assert.deepEqual(inspectorItems.map((item) => item.status), ["assigned", "escalated"]);
    assert.deepEqual(inspectorItems[0]?.source, { messageId: 1001, conversationId: 3001 });
    assert.deepEqual(inspectorItems[0]?.sourceEmail, {
      senderEmail: "inspector@example.test",
      subject: "East entry",
      body: "The door closer is loose.",
      storedMessageBody: "From inspector: inspector@example.test\nSubject: East entry\n\nThe door closer is loose.",
      receivedAt: "2026-05-01T09:00:00.000Z",
    });
    assert.equal(inspectorItems[0]?.task.taskNotes, "Check the door closer");
    assert.equal(inspectorItems[0]?.task.beforeImagePath, "/objects/before/101");
    assert.equal(inspectorItems[0]?.task.afterImagePath, null);
    assert.equal(inspectorItems[0]?.history[0]?.event, "assigned");
    assert.deepEqual(reads[0]?.from, new Date("2026-05-01T04:00:00.000Z"));
    assert.deepEqual(reads[0]?.toExclusive, new Date("2026-05-03T04:00:00.000Z"));
    assert.equal(reads[0]?.actor.id, 10);

    const dstRangeResponse = await fetch(`${base}?from=2026-03-08&to=2026-03-08`);
    assert.equal(dstRangeResponse.status, 200);
    assert.deepEqual(reads[1]?.from, new Date("2026-03-08T05:00:00.000Z"));
    assert.deepEqual(reads[1]?.toExclusive, new Date("2026-03-09T04:00:00.000Z"));

    actor = { id: 20, role: "staff" };
    const staffResponse = await fetch(base);
    assert.equal(staffResponse.status, 200);
    assert.deepEqual((await staffResponse.json() as Array<{ task: { id: number } }>).map((item) => item.task.id), [101]);

    actor = { id: 30, role: "supervisor" };
    const managerResponse = await fetch(base);
    assert.equal(managerResponse.status, 200);
    const managerItems = await managerResponse.json() as Array<{ task: { id: number; completed: boolean; completedAt: string | null } }>;
    assert.deepEqual(managerItems.map((item) => item.task.id), [101, 102, 103]);
    assert.equal(managerItems[2]?.task.completed, true);
    assert.equal(managerItems[2]?.task.completedAt, "2026-05-03T11:00:00.000Z");

    actor = { id: 20, role: "staff" };
    const invalidRange = await fetch(`${base}?from=2026-02-30&to=2026-03-01`);
    assert.equal(invalidRange.status, 400);
    const incompleteRange = await fetch(`${base}?from=2026-05-01`);
    assert.equal(incompleteRange.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("inspector assignment report endpoint rejects a non-staff actor role before reading linked tasks", async () => {
  let reads = 0;
  const app = express();
  app.use(createInspectorAssignmentsRouter({
    resolveActor: (async () => ({ id: 9, role: "guest" })) as never,
    readRows: async () => { reads++; return rows; },
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/inspector-assignments`);
    assert.equal(response.status, 403);
    assert.equal(reads, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
