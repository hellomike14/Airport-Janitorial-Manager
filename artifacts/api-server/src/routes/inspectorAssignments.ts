import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import {
  areasTable,
  inboundEmailMessagesTable,
  inspectorTaskAssignmentHistoryTable,
  inspectorTaskLinksTable,
  messagesTable,
  staffTable,
  tasksTable,
} from "@workspace/db/schema";
import {
  ListInspectorAssignmentsResponse,
} from "@workspace/api-zod";
import { and, asc, desc, eq, gte, inArray, lt, type SQL } from "drizzle-orm";
import { z } from "zod";
import { actorStaffFromRequest } from "../lib/actorSession";
import { orlandoStartOfDay, orlandoStartOfNextDay } from "../lib/operationsPolicy";

type Actor = NonNullable<Awaited<ReturnType<typeof actorStaffFromRequest>>>;
type AssignmentHistoryRow = {
  assignedStaffId: number;
  assignedById: number | null;
  event: string;
  method: string;
  distanceMeters: number | null;
  provenance: string;
  createdAt: Date;
};

export type InspectorAssignmentRow = {
  taskId: number;
  taskName: string;
  taskDate: string;
  completed: boolean;
  completedAt: Date | null;
  completedById: number | null;
  taskNotes: string | null;
  beforeImagePath: string | null;
  afterImagePath: string | null;
  taskCreatedAt: Date;
  assignedStaffId: number | null;
  assignedStaffName: string | null;
  sourceMessageId: number;
  conversationId: number;
  inspectorId: number;
  supervisorId: number;
  sourceBody: string;
  receivedAt: Date;
  dueAt: Date;
  escalatedAt: Date | null;
  assignmentMethod: "fresh_gps" | "area_roster_workload";
  assignmentDistanceMeters: number | null;
  areaId: number;
  areaName: string;
  terminal: string;
  history: AssignmentHistoryRow[];
};

export type InspectorAssignmentReadArgs = {
  actor: Pick<Actor, "id" | "role">;
  from: Date | null;
  toExclusive: Date | null;
};

type RouterDependencies = {
  readRows?: (args: InspectorAssignmentReadArgs) => Promise<InspectorAssignmentRow[]>;
  resolveActor?: typeof actorStaffFromRequest;
  now?: () => Date;
};

const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Expected a valid calendar date");

const ListQuery = z.object({
  from: DateOnly.optional(),
  to: DateOnly.optional(),
}).strict().superRefine((value, context) => {
  if ((value.from && !value.to) || (!value.from && value.to)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "from and to must be provided together" });
  }
  if (value.from && value.to && value.from > value.to) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "from must not be after to" });
  }
});

function dayStart(value: string): Date {
  return orlandoStartOfDay(value);
}

function dayAfter(value: string): Date {
  return orlandoStartOfNextDay(value);
}

function isVisibleToActor(actor: Pick<Actor, "id" | "role">, row: InspectorAssignmentRow): boolean {
  if (actor.role === "admin" || actor.role === "supervisor") return true;
  if (actor.role === "inspector") return actor.id === row.inspectorId;
  if (actor.role === "staff") return actor.id === row.assignedStaffId;
  return false;
}

function parseStoredInspectorEmail(storedMessageBody: string) {
  const senderLine = /^From inspector: ([^\r\n]+)\r?\n/.exec(storedMessageBody);
  if (!senderLine) {
    return { senderEmail: null, subject: null, body: null, storedMessageBody };
  }
  const rest = storedMessageBody.slice(senderLine[0].length);
  const parsed = /^(?:Subject: ([^\r\n]*)\r?\n)?\r?\n([\s\S]*)$/.exec(rest);
  if (!parsed) {
    return { senderEmail: senderLine[1]!.trim(), subject: null, body: null, storedMessageBody };
  }
  return {
    senderEmail: senderLine[1]!.trim(),
    subject: parsed[1] ?? null,
    body: parsed[2]!,
    storedMessageBody,
  };
}

function serializeAssignment(row: InspectorAssignmentRow, now: Date) {
  const sourceEmail = parseStoredInspectorEmail(row.sourceBody);
  return {
    source: { conversationId: row.conversationId, messageId: row.sourceMessageId },
    sourceEmail: { ...sourceEmail, receivedAt: row.receivedAt },
    task: {
      id: row.taskId,
      name: row.taskName,
      taskDate: row.taskDate,
      completed: row.completed,
      completedAt: row.completedAt,
      completedById: row.completedById,
      taskNotes: row.taskNotes,
      beforeImagePath: row.beforeImagePath,
      afterImagePath: row.afterImagePath,
      createdAt: row.taskCreatedAt,
    },
    area: { id: row.areaId, name: row.areaName, terminal: row.terminal },
    assignedStaff: row.assignedStaffId && row.assignedStaffName
      ? { id: row.assignedStaffId, name: row.assignedStaffName }
      : null,
    assignmentMethod: row.assignmentMethod,
    assignmentDistanceMeters: row.assignmentDistanceMeters,
    dueAt: row.dueAt,
    remainingSeconds: Math.max(0, Math.ceil((row.dueAt.getTime() - now.getTime()) / 1000)),
    status: row.completed
      ? "completed"
      : row.escalatedAt
        ? "escalated"
        : row.dueAt.getTime() <= now.getTime()
          ? "overdue"
          : "assigned",
    escalatedAt: row.escalatedAt,
    history: row.history,
  };
}

async function readInspectorAssignments({ actor, from, toExclusive }: InspectorAssignmentReadArgs): Promise<InspectorAssignmentRow[]> {
  const conditions: (SQL | undefined)[] = [
    from ? gte(inboundEmailMessagesTable.receivedAt, from) : undefined,
    toExclusive ? lt(inboundEmailMessagesTable.receivedAt, toExclusive) : undefined,
    actor.role === "inspector" ? eq(inspectorTaskLinksTable.inspectorId, actor.id) : undefined,
    actor.role === "staff" ? eq(tasksTable.assignedToId, actor.id) : undefined,
  ];
  const rows = await db.select({
    taskId: tasksTable.id,
    taskName: tasksTable.taskName,
    taskDate: tasksTable.taskDate,
    completed: tasksTable.completed,
    completedAt: tasksTable.completedAt,
    completedById: tasksTable.completedById,
    taskNotes: tasksTable.notes,
    beforeImagePath: tasksTable.beforeImagePath,
    afterImagePath: tasksTable.afterImagePath,
    taskCreatedAt: tasksTable.createdAt,
    assignedStaffId: tasksTable.assignedToId,
    assignedStaffName: staffTable.name,
    sourceMessageId: inspectorTaskLinksTable.sourceMessageId,
    conversationId: inspectorTaskLinksTable.conversationId,
    inspectorId: inspectorTaskLinksTable.inspectorId,
    supervisorId: inspectorTaskLinksTable.supervisorId,
    sourceBody: messagesTable.body,
    receivedAt: inboundEmailMessagesTable.receivedAt,
    dueAt: inspectorTaskLinksTable.dueAt,
    escalatedAt: inspectorTaskLinksTable.escalatedAt,
    assignmentMethod: inspectorTaskLinksTable.assignmentMethod,
    assignmentDistanceMeters: inspectorTaskLinksTable.assignmentDistanceMeters,
    areaId: areasTable.id,
    areaName: areasTable.name,
    terminal: areasTable.terminal,
  }).from(inspectorTaskLinksTable)
    .innerJoin(tasksTable, eq(tasksTable.id, inspectorTaskLinksTable.taskId))
    .innerJoin(messagesTable, eq(messagesTable.id, inspectorTaskLinksTable.sourceMessageId))
    .innerJoin(inboundEmailMessagesTable, and(
      eq(inboundEmailMessagesTable.messageId, inspectorTaskLinksTable.sourceMessageId),
      eq(inboundEmailMessagesTable.conversationId, inspectorTaskLinksTable.conversationId),
    ))
    .innerJoin(areasTable, eq(areasTable.id, tasksTable.areaId))
    .leftJoin(staffTable, eq(staffTable.id, tasksTable.assignedToId))
    .where(and(...conditions))
    .orderBy(desc(inboundEmailMessagesTable.receivedAt), desc(tasksTable.id));

  if (!rows.length) return [];
  const historyRows = await db.select({
    taskId: inspectorTaskAssignmentHistoryTable.taskId,
    assignedStaffId: inspectorTaskAssignmentHistoryTable.assignedStaffId,
    assignedById: inspectorTaskAssignmentHistoryTable.assignedById,
    event: inspectorTaskAssignmentHistoryTable.event,
    method: inspectorTaskAssignmentHistoryTable.method,
    distanceMeters: inspectorTaskAssignmentHistoryTable.distanceMeters,
    provenance: inspectorTaskAssignmentHistoryTable.provenance,
    createdAt: inspectorTaskAssignmentHistoryTable.createdAt,
  }).from(inspectorTaskAssignmentHistoryTable)
    .where(inArray(inspectorTaskAssignmentHistoryTable.taskId, rows.map((row) => row.taskId)))
    .orderBy(asc(inspectorTaskAssignmentHistoryTable.id));

  const historyByTaskId = new Map<number, AssignmentHistoryRow[]>();
  for (const item of historyRows) {
    const list = historyByTaskId.get(item.taskId) ?? [];
    list.push({
      assignedStaffId: item.assignedStaffId,
      assignedById: item.assignedById,
      event: item.event,
      method: item.method,
      distanceMeters: item.distanceMeters,
      provenance: item.provenance,
      createdAt: item.createdAt,
    });
    historyByTaskId.set(item.taskId, list);
  }
  return rows.map((row) => ({ ...row, history: historyByTaskId.get(row.taskId) ?? [] }));
}

export function createInspectorAssignmentsRouter(dependencies: RouterDependencies = {}): IRouter {
  const router: IRouter = Router();
  const resolveActor = dependencies.resolveActor ?? actorStaffFromRequest;
  const readRows = dependencies.readRows ?? readInspectorAssignments;
  const getNow = dependencies.now ?? (() => new Date());

  router.get("/inspector-assignments", async (req: Request, res): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const actor = await resolveActor(req);
    if (!actor) {
      res.status(401).json({ error: "Login session required" });
      return;
    }
    if (!["admin", "supervisor", "inspector", "staff"].includes(actor.role)) {
      res.status(403).json({ error: "Role is not allowed to view inspector assignments" });
      return;
    }

    const query = ListQuery.safeParse({
      from: req.query.from,
      to: req.query.to,
    });
    if (!query.success) {
      res.status(400).json({ error: "Provide a valid from/to date range, or omit both dates" });
      return;
    }
    const from = query.data.from ? dayStart(query.data.from) : null;
    const toExclusive = query.data.to ? dayAfter(query.data.to) : null;
    const rows = await readRows({ actor, from, toExclusive });
    const now = getNow();
    const visible = rows.filter((row) => {
      if (!isVisibleToActor(actor, row)) return false;
      if (from && row.receivedAt < from) return false;
      if (toExclusive && row.receivedAt >= toExclusive) return false;
      return true;
    });
    const response = ListInspectorAssignmentsResponse.parse(visible.map((row) => serializeAssignment(row, now)));
    res.json(response);
  });

  return router;
}

export default createInspectorAssignmentsRouter();
