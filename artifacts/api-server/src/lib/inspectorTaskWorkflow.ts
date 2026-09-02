import { db } from "@workspace/db";
import {
  areasTable,
  assignmentsTable,
  conversationArchivesTable,
  conversationsTable,
  inboundEmailMessagesTable,
  inspectorTaskLinksTable,
  messageEmailOutboxTable,
  messagesTable,
  notificationsTable,
  staffLocationsTable,
  staffTable,
  tasksTable,
} from "@workspace/db/schema";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  extractInspectorRequestedDate,
  extractInspectorTargetCoordinates,
  inspectorAssignmentDueAt,
  matchInspectorMessageArea,
  selectAssignedStaff,
  type StaffAssignmentCandidate,
  type TargetCoordinates,
} from "./inspectorAssignmentPolicy";
import {
  attemptMessageEmailOutboxDelivery,
  wakeMessageEmailOutboxWorker,
} from "./messageEmailOutbox";
import {
  initialEmailDeliveryStatus,
  type PublicEmailDeliveryStatus,
} from "./messageEmailDeliveryPolicy";
import { outboundBridgeConfiguration } from "./sendgridEmailBridge";

const INSPECTOR_EMAIL = "inspector@marvolenterprises.com";

export type InspectorMessageAssignmentResult =
  | {
      status: "assigned" | "already_assigned";
      taskId: number;
      assignedStaffId: number;
      assignedStaffName: string;
      areaId: number;
      areaName: string;
      taskDate: string;
      dueAt: string;
      assignmentMethod: "fresh_gps" | "area_roster_workload";
      distanceMeters: number | null;
    }
  | {
      status:
        | "message_not_found"
        | "not_authorized"
        | "invalid_area"
        | "no_eligible_staff";
    };

export function airportDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export type InspectorTaskCompletionEmailResult = {
  status: PublicEmailDeliveryStatus;
  messageId: number | null;
};

/**
 * Persist exactly one completion message + outbound email intent for an
 * inspector-origin task. The link row is locked so a double tap or retried
 * completion request cannot send the inspector twice.
 */
export async function queueInspectorTaskCompletionEmail(input: {
  taskId: number;
  completedByName: string;
  completedAt: Date;
}): Promise<InspectorTaskCompletionEmailResult> {
  const queued = await db.transaction(async (tx) => {
    const [link] = await tx
      .select()
      .from(inspectorTaskLinksTable)
      .where(eq(inspectorTaskLinksTable.taskId, input.taskId))
      .for("update");
    if (!link) {
      return {
        status: "not_applicable" as const,
        messageId: null,
      };
    }

    if (link.completionMessageId) {
      const [existingOutbox] = await tx
        .select({ status: messageEmailOutboxTable.status })
        .from(messageEmailOutboxTable)
        .where(
          eq(
            messageEmailOutboxTable.messageId,
            link.completionMessageId,
          ),
        );
      return {
        status:
          existingOutbox?.status ?? ("not_applicable" as const),
        messageId: link.completionMessageId,
      };
    }

    const [task] = await tx
      .select({
        taskName: tasksTable.taskName,
        areaName: areasTable.name,
        completed: tasksTable.completed,
      })
      .from(tasksTable)
      .innerJoin(areasTable, eq(tasksTable.areaId, areasTable.id))
      .where(eq(tasksTable.id, input.taskId));
    const [inspector] = await tx
      .select()
      .from(staffTable)
      .where(eq(staffTable.id, link.inspectorId));
    const [supervisor] = await tx
      .select()
      .from(staffTable)
      .where(eq(staffTable.id, link.supervisorId));
    if (
      !task ||
      !task.completed ||
      !inspector ||
      inspector.role !== "inspector" ||
      inspector.email?.trim().toLocaleLowerCase("en-US") !== INSPECTOR_EMAIL ||
      !supervisor ||
      supervisor.role !== "supervisor"
    ) {
      throw new Error("Inspector completion email participants are invalid");
    }

    const completedAt = input.completedAt.toLocaleString("en-US", {
      timeZone: "America/New_York",
      dateStyle: "medium",
      timeStyle: "short",
    });
    const completionBody = [
      "COMPLETED — Inspector special assignment",
      `Area: ${task.areaName}`,
      `Task: ${task.taskName}`,
      `Completed by: ${input.completedByName}`,
      `Completed at: ${completedAt} ET`,
    ].join("\n");
    const initialStatus = initialEmailDeliveryStatus(
      true,
      outboundBridgeConfiguration(),
    );
    const [message] = await tx
      .insert(messagesTable)
      .values({
        conversationId: link.conversationId,
        // Completion mail is an operational system update in the original
        // supervisor/inspector channel. The human completer remains named in
        // the immutable message body and on the task audit record.
        senderId: supervisor.id,
        body: completionBody,
      })
      .returning();

    if (initialStatus !== "not_applicable") {
      await tx.insert(messageEmailOutboxTable).values({
        messageId: message.id,
        conversationId: link.conversationId,
        inspectorId: inspector.id,
        supervisorId: supervisor.id,
        inspectorEmail: inspector.email!,
        inspectorName: inspector.name,
        supervisorName: supervisor.name,
        messageBody: completionBody,
        status: initialStatus,
      });
    }
    await tx
      .update(inspectorTaskLinksTable)
      .set({ completionMessageId: message.id })
      .where(
        and(
          eq(inspectorTaskLinksTable.taskId, input.taskId),
          isNull(inspectorTaskLinksTable.completionMessageId),
        ),
      );
    await tx
      .delete(conversationArchivesTable)
      .where(eq(conversationArchivesTable.conversationId, link.conversationId));
    await tx.insert(notificationsTable).values({
      staffId: inspector.id,
      type: "task_completed" as const,
      message: `${input.completedByName} completed the inspector task in ${task.areaName}.`,
      isRead: false,
    });
    return { status: initialStatus, messageId: message.id };
  });

  let status = queued.status;
  if (
    queued.messageId !== null &&
    (status === "pending" || status === "sending")
  ) {
    try {
      status = await attemptMessageEmailOutboxDelivery(queued.messageId);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "inspector_task_completion_email_initial_attempt",
          status: "failed",
          taskId: input.taskId,
          messageId: queued.messageId,
          error:
            error instanceof Error ? error.message : "Unknown outbox error",
        }),
      );
      wakeMessageEmailOutboxWorker();
    }
  }
  return { status, messageId: queued.messageId };
}

async function eligibleCandidates(
  tx: any,
  areaId: number,
  taskDate: string,
): Promise<{
  candidates: StaffAssignmentCandidate[];
  names: Map<number, string>;
}> {
  const roster = await tx
    .select({ staffId: staffTable.id, name: staffTable.name })
    .from(assignmentsTable)
    .innerJoin(staffTable, eq(assignmentsTable.staffId, staffTable.id))
    .where(
      and(
        eq(assignmentsTable.areaId, areaId),
        eq(assignmentsTable.assignmentDate, taskDate),
        eq(staffTable.role, "staff"),
        eq(staffTable.active, true),
        eq(staffTable.loginEnabled, true),
      ),
    )
    .orderBy(asc(staffTable.id));
  const uniqueRoster = [
    ...new Map(
      roster.map((row: { staffId: number; name: string }) => [row.staffId, row]),
    ).values(),
  ] as { staffId: number; name: string }[];
  const ids = uniqueRoster.map((row) => row.staffId);
  if (ids.length === 0) return { candidates: [], names: new Map() };

  const [workloads, locations] = await Promise.all([
    tx
      .select({
        staffId: tasksTable.assignedToId,
        count: sql<number>`count(*)::int`,
      })
      .from(tasksTable)
      .where(
        and(
          inArray(tasksTable.assignedToId, ids),
          eq(tasksTable.isSpecial, true),
          eq(tasksTable.completed, false),
        ),
      )
      .groupBy(tasksTable.assignedToId),
    tx
      .select({
        staffId: staffLocationsTable.staffId,
        latitude: staffLocationsTable.latitude,
        longitude: staffLocationsTable.longitude,
        updatedAt: staffLocationsTable.updatedAt,
      })
      .from(staffLocationsTable)
      .where(inArray(staffLocationsTable.staffId, ids))
      .orderBy(asc(staffLocationsTable.staffId), desc(staffLocationsTable.updatedAt)),
  ]);

  const workloadByStaff = new Map<number, number>(
    workloads.map((row: { staffId: number | null; count: number }) => [
      row.staffId!,
      row.count,
    ]),
  );
  const latestByStaff = new Map<
    number,
    { latitude: number; longitude: number; updatedAt: Date }
  >();
  for (const row of locations as {
    staffId: number;
    latitude: number;
    longitude: number;
    updatedAt: Date;
  }[]) {
    if (!latestByStaff.has(row.staffId)) latestByStaff.set(row.staffId, row);
  }
  return {
    candidates: uniqueRoster.map((row) => ({
      staffId: row.staffId,
      incompleteSpecialTaskCount: workloadByStaff.get(row.staffId) ?? 0,
      latestLocation: latestByStaff.get(row.staffId) ?? null,
    })),
    names: new Map(uniqueRoster.map((row) => [row.staffId, row.name])),
  };
}

export async function assignInspectorMessageToStaff(input: {
  messageId: number;
  managerId: number;
  areaId: number;
  taskDate: string;
  targetCoordinates: TargetCoordinates | null;
  now?: Date;
}): Promise<InspectorMessageAssignmentResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select({
        messageId: messagesTable.id,
        conversationId: messagesTable.conversationId,
        inspectorId: messagesTable.senderId,
        body: messagesTable.body,
        participantAId: conversationsTable.participantAId,
        participantBId: conversationsTable.participantBId,
        isGroup: conversationsTable.isGroup,
        inspectorEmail: staffTable.email,
        inspectorRole: staffTable.role,
        inspectorActive: staffTable.active,
        inspectorLoginEnabled: staffTable.loginEnabled,
      })
      .from(messagesTable)
      .innerJoin(
        inboundEmailMessagesTable,
        eq(inboundEmailMessagesTable.messageId, messagesTable.id),
      )
      .innerJoin(
        conversationsTable,
        eq(messagesTable.conversationId, conversationsTable.id),
      )
      .innerJoin(staffTable, eq(messagesTable.senderId, staffTable.id))
      .where(eq(messagesTable.id, input.messageId))
      .for("update");
    if (!source) return { status: "message_not_found" as const };

    const [manager] = await tx
      .select()
      .from(staffTable)
      .where(eq(staffTable.id, input.managerId));
    const participantIds = new Set([
      source.participantAId ?? 0,
      source.participantBId ?? 0,
    ]);
    const inspectorIsExact =
      source.inspectorRole === "inspector" &&
      source.inspectorActive &&
      source.inspectorLoginEnabled &&
      source.inspectorEmail?.trim().toLocaleLowerCase("en-US") === INSPECTOR_EMAIL;
    if (
      source.isGroup ||
      !inspectorIsExact ||
      !manager ||
      (manager.role !== "supervisor" && manager.role !== "admin") ||
      !manager.active ||
      !manager.loginEnabled ||
      !participantIds.has(input.managerId) ||
      !participantIds.has(source.inspectorId)
    ) {
      return { status: "not_authorized" as const };
    }

    const [existingLink] = await tx
      .select({
        taskId: inspectorTaskLinksTable.taskId,
        dueAt: inspectorTaskLinksTable.dueAt,
        assignmentMethod: inspectorTaskLinksTable.assignmentMethod,
        areaId: tasksTable.areaId,
        taskDate: tasksTable.taskDate,
        assignedStaffId: tasksTable.assignedToId,
        assignedStaffName: staffTable.name,
        areaName: areasTable.name,
      })
      .from(inspectorTaskLinksTable)
      .innerJoin(tasksTable, eq(inspectorTaskLinksTable.taskId, tasksTable.id))
      .innerJoin(areasTable, eq(tasksTable.areaId, areasTable.id))
      .leftJoin(staffTable, eq(tasksTable.assignedToId, staffTable.id))
      .where(eq(inspectorTaskLinksTable.sourceMessageId, input.messageId));
    if (existingLink?.assignedStaffId && existingLink.assignedStaffName) {
      return {
        status: "already_assigned" as const,
        taskId: existingLink.taskId,
        assignedStaffId: existingLink.assignedStaffId,
        assignedStaffName: existingLink.assignedStaffName,
        areaId: existingLink.areaId,
        areaName: existingLink.areaName,
        taskDate: existingLink.taskDate,
        dueAt: existingLink.dueAt.toISOString(),
        assignmentMethod: existingLink.assignmentMethod,
        distanceMeters: null,
      };
    }

    const [area] = await tx
      .select({ id: areasTable.id, name: areasTable.name })
      .from(areasTable)
      .where(
        and(eq(areasTable.id, input.areaId), eq(areasTable.archived, false)),
      );
    if (!area) return { status: "invalid_area" as const };

    const roster = await eligibleCandidates(tx, input.areaId, input.taskDate);
    const selection = selectAssignedStaff(
      roster.candidates,
      input.targetCoordinates,
      now,
    );
    if (!selection) return { status: "no_eligible_staff" as const };

    const [maxOrder] = await tx
      .select({ maxO: sql<number>`coalesce(max(${tasksTable.taskOrder}), 0)::int` })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.areaId, input.areaId),
          eq(tasksTable.taskDate, input.taskDate),
        ),
      );
    const [task] = await tx
      .insert(tasksTable)
      .values({
        areaId: input.areaId,
        taskDate: input.taskDate,
        taskName: source.body,
        taskOrder: (maxOrder?.maxO ?? 0) + 1,
        completed: false,
        assignedToId: selection.staffId,
        isSpecial: true,
        createdById: source.inspectorId,
        notes: source.body,
        createdAt: now,
      })
      .returning();
    const dueAt = inspectorAssignmentDueAt(now);
    await tx.insert(inspectorTaskLinksTable).values({
      taskId: task.id,
      sourceMessageId: source.messageId,
      conversationId: source.conversationId,
      inspectorId: source.inspectorId,
      supervisorId: input.managerId,
      assignmentMethod: selection.method,
      targetLatitude: input.targetCoordinates?.latitude ?? null,
      targetLongitude: input.targetCoordinates?.longitude ?? null,
      dueAt,
      createdAt: now,
    });

    const assignedStaffName = roster.names.get(selection.staffId) ?? "Assigned staff";
    const managerMessage = `URGENT inspector task assigned to ${assignedStaffName} in ${area.name}; due within 15 minutes.`;
    const managers = await tx
      .select({ id: staffTable.id })
      .from(staffTable)
      .where(
        and(
          inArray(staffTable.role, ["supervisor", "admin"]),
          eq(staffTable.active, true),
          eq(staffTable.loginEnabled, true),
        ),
      );
    const managerIds = [...new Set(managers.map((row: { id: number }) => row.id))];
    await tx.insert(notificationsTable).values([
      ...managerIds.map((staffId) => ({
        staffId,
        type: "inspector_to_supervisor" as const,
        message: managerMessage,
        isRead: false,
      })),
      {
        staffId: selection.staffId,
        type: "direct_alert" as const,
        message: `URGENT inspector task in ${area.name}: ${source.body.slice(0, 240)}. Complete within 15 minutes.`,
        isRead: false,
      },
    ]);
    await tx
      .delete(conversationArchivesTable)
      .where(eq(conversationArchivesTable.conversationId, source.conversationId));

    return {
      status: "assigned" as const,
      taskId: task.id,
      assignedStaffId: selection.staffId,
      assignedStaffName,
      areaId: area.id,
      areaName: area.name,
      taskDate: input.taskDate,
      dueAt: dueAt.toISOString(),
      assignmentMethod: selection.method,
      distanceMeters: selection.distanceMeters,
    };
  });
}

export type AutoAssignInspectorMessageResult =
  | InspectorMessageAssignmentResult
  | { status: "triage_required"; reason: "missing_location" | "ambiguous_location" };

export async function autoAssignInspectorMessage(input: {
  messageId: number;
  managerId: number;
  messageBody: string;
  now?: Date;
}): Promise<AutoAssignInspectorMessageResult> {
  const areas = await db
    .select({ id: areasTable.id, name: areasTable.name, terminal: areasTable.terminal })
    .from(areasTable)
    .where(eq(areasTable.archived, false));
  const match = matchInspectorMessageArea(input.messageBody, areas);
  if (match.status !== "matched") {
    return {
      status: "triage_required",
      reason: match.status === "ambiguous" ? "ambiguous_location" : "missing_location",
    };
  }
  return assignInspectorMessageToStaff({
    messageId: input.messageId,
    managerId: input.managerId,
    areaId: match.areaId,
    taskDate: extractInspectorRequestedDate(input.messageBody) ?? airportDate(input.now),
    targetCoordinates: extractInspectorTargetCoordinates(input.messageBody),
    now: input.now,
  });
}

export async function sweepOverdueInspectorAssignments(
  now = new Date(),
): Promise<{ inspected: number; escalated: number; reassigned: number }> {
  const dueRows = await db
    .select({ taskId: inspectorTaskLinksTable.taskId })
    .from(inspectorTaskLinksTable)
    .innerJoin(tasksTable, eq(inspectorTaskLinksTable.taskId, tasksTable.id))
    .where(
      and(
        isNull(inspectorTaskLinksTable.escalatedAt),
        lte(inspectorTaskLinksTable.dueAt, now),
        eq(tasksTable.completed, false),
      ),
    )
    .orderBy(asc(inspectorTaskLinksTable.dueAt))
    .limit(100);

  let escalated = 0;
  let reassigned = 0;
  for (const dueRow of dueRows) {
    const outcome = await db.transaction(async (tx) => {
      const [link] = await tx
        .select()
        .from(inspectorTaskLinksTable)
        .where(eq(inspectorTaskLinksTable.taskId, dueRow.taskId))
        .for("update");
      if (!link || link.escalatedAt || link.dueAt.getTime() > now.getTime()) return "skipped" as const;
      const [task] = await tx
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, dueRow.taskId))
        .for("update");
      if (!task || task.completed) return "skipped" as const;

      const roster = await eligibleCandidates(tx, task.areaId, task.taskDate);
      const target =
        link.targetLatitude !== null && link.targetLongitude !== null
          ? { latitude: link.targetLatitude, longitude: link.targetLongitude }
          : null;
      const selection = selectAssignedStaff(
        roster.candidates,
        target,
        now,
        undefined,
        new Set(task.assignedToId === null ? [] : [task.assignedToId]),
      );
      const [area] = await tx
        .select({ name: areasTable.name })
        .from(areasTable)
        .where(eq(areasTable.id, task.areaId));
      const nextName = selection ? roster.names.get(selection.staffId) : null;

      await tx
        .update(inspectorTaskLinksTable)
        .set({
          escalatedAt: now,
          escalationStaffId: selection?.staffId ?? null,
        })
        .where(
          and(
            eq(inspectorTaskLinksTable.taskId, task.id),
            isNull(inspectorTaskLinksTable.escalatedAt),
          ),
        );
      if (selection) {
        await tx
          .update(tasksTable)
          .set({ assignedToId: selection.staffId })
          .where(and(eq(tasksTable.id, task.id), eq(tasksTable.completed, false)));
      }

      const managers = await tx
        .select({ id: staffTable.id })
        .from(staffTable)
        .where(
          and(
            inArray(staffTable.role, ["supervisor", "admin"]),
            eq(staffTable.active, true),
            eq(staffTable.loginEnabled, true),
          ),
        );
      const managerText = selection
        ? `URGENT OVERDUE inspector task in ${area?.name ?? "assigned area"} was reassigned to ${nextName ?? "the next staff member"}.`
        : `URGENT OVERDUE inspector task in ${area?.name ?? "assigned area"}; no second eligible on-area staff member is available.`;
      const values = [
        ...managers.map((manager: { id: number }) => ({
          staffId: manager.id,
          type: "inspector_to_supervisor" as const,
          message: managerText,
          isRead: false,
        })),
        ...(selection
          ? [
              {
                staffId: selection.staffId,
                type: "direct_alert" as const,
                message: `URGENT OVERDUE inspector task assigned to you in ${area?.name ?? "your area"}: ${task.taskName.slice(0, 240)}`,
                isRead: false,
              },
            ]
          : []),
      ];
      if (values.length > 0) await tx.insert(notificationsTable).values(values);
      return selection ? ("reassigned" as const) : ("escalated" as const);
    });
    if (outcome !== "skipped") escalated += 1;
    if (outcome === "reassigned") reassigned += 1;
  }
  return { inspected: dueRows.length, escalated, reassigned };
}

let activeEscalationWorkerStop: (() => void) | null = null;

/**
 * Best-effort in-process sweep for always-on deployments. Autoscale instances
 * may sleep, so production also exposes a secret-protected cron endpoint that
 * must be called at least once per minute for a dependable 15-minute SLA.
 */
export function startInspectorAssignmentEscalationWorker(
  env: Record<string, string | undefined> = process.env,
): () => void {
  activeEscalationWorkerStop?.();
  let stopped = false;
  let running = false;
  const parsed = Number(env.INSPECTOR_ESCALATION_POLL_MS);
  const pollMs =
    Number.isInteger(parsed) && parsed >= 10_000 && parsed <= 300_000
      ? parsed
      : 30_000;

  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const result = await sweepOverdueInspectorAssignments();
      if (result.escalated > 0) {
        console.info(
          JSON.stringify({
            event: "inspector_assignment_escalation_sweep",
            ...result,
          }),
        );
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "inspector_assignment_escalation_sweep",
          status: "failed",
          error:
            error instanceof Error ? error.message : "Unknown escalation error",
        }),
      );
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void run(), pollMs);
  timer.unref();
  queueMicrotask(() => void run());
  const stop = () => {
    stopped = true;
    clearInterval(timer);
    if (activeEscalationWorkerStop === stop) activeEscalationWorkerStop = null;
  };
  activeEscalationWorkerStop = stop;
  return stop;
}
