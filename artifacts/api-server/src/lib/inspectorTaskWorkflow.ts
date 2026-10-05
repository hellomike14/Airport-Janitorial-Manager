import { db } from "@workspace/db";
import { areasTable, assignmentsTable, inboundEmailMessagesTable, inspectorTaskAssignmentHistoryTable, inspectorTaskLinksTable, messagesTable, notificationsTable, staffLocationsTable, staffTable, tasksTable } from "@workspace/db/schema";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { extractInspectorTargetCoordinates, inspectorAssignmentDueAt, matchInspectorMessageArea, selectAssignedStaff, type StaffAssignmentCandidate } from "./inspectorAssignmentPolicy";

const today = (now: Date) => now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
async function roster(tx: any, areaId: number, date: string) {
  const rows = await tx.select({ id: staffTable.id, name: staffTable.name, latitude: staffLocationsTable.latitude, longitude: staffLocationsTable.longitude, accuracy: staffLocationsTable.accuracy, updatedAt: staffLocationsTable.updatedAt })
    .from(assignmentsTable).innerJoin(staffTable, eq(assignmentsTable.staffId, staffTable.id))
    .leftJoin(staffLocationsTable, eq(staffLocationsTable.staffId, staffTable.id))
    .where(and(eq(assignmentsTable.areaId, areaId), eq(assignmentsTable.assignmentDate, date), eq(staffTable.role, "staff"), eq(staffTable.active, true), eq(staffTable.loginEnabled, true))).orderBy(asc(staffTable.id));
  const ids = [...new Set(rows.map((row: any) => row.id))] as number[];
  const loads = ids.length ? await tx.select({ id: tasksTable.assignedToId, count: sql<number>`count(*)::int` }).from(tasksTable)
    .where(and(inArray(tasksTable.assignedToId, ids), eq(tasksTable.isSpecial, true), eq(tasksTable.completed, false))).groupBy(tasksTable.assignedToId) : [];
  const counts = new Map<number, number>(loads.map((row: any) => [row.id as number, row.count as number]));
  return [...new Map(rows.map((row: any) => [row.id, row])).values()].map((row: any): StaffAssignmentCandidate & { name: string } => ({
    staffId: row.id, name: row.name, incompleteSpecialTaskCount: counts.get(row.id) ?? 0,
    latestLocation: row.updatedAt ? { latitude: row.latitude, longitude: row.longitude, accuracy: row.accuracy, updatedAt: row.updatedAt } : null,
  }));
}

/** Creates exactly one task for each accepted inbound message, under a row lock. */
export async function autoAssignInboundInspectorMessage(messageId: number, supervisorId: number, now = new Date()) {
  return db.transaction(async (tx) => {
    const [source] = await tx.select({ body: messagesTable.body, conversationId: messagesTable.conversationId, inspectorId: messagesTable.senderId })
      .from(messagesTable).innerJoin(inboundEmailMessagesTable, eq(inboundEmailMessagesTable.messageId, messagesTable.id)).where(eq(messagesTable.id, messageId)).for("update");
    if (!source) return { status: "not_inbound" as const };
    const [existing] = await tx.select({ taskId: inspectorTaskLinksTable.taskId }).from(inspectorTaskLinksTable).where(eq(inspectorTaskLinksTable.sourceMessageId, messageId));
    if (existing) return { status: "already_assigned" as const, taskId: existing.taskId };
    const areas = await tx.select({ id: areasTable.id, name: areasTable.name, terminal: areasTable.terminal }).from(areasTable).where(eq(areasTable.archived, false));
    const match = matchInspectorMessageArea(source.body, areas);
    if (match.status !== "matched") return { status: "triage_required" as const, reason: match.status };
    const date = today(now), candidates = await roster(tx, match.areaId, date);
    const selection = selectAssignedStaff(candidates, extractInspectorTargetCoordinates(source.body), now);
    if (!selection) return { status: "no_eligible_staff" as const };
    const [max] = await tx.select({ value: sql<number>`coalesce(max(${tasksTable.taskOrder}), 0)::int` }).from(tasksTable).where(and(eq(tasksTable.areaId, match.areaId), eq(tasksTable.taskDate, date)));
    const [task] = await tx.insert(tasksTable).values({ areaId: match.areaId, taskDate: date, taskName: source.body, notes: source.body, taskOrder: (max?.value ?? 0) + 1, isSpecial: true, assignedToId: selection.staffId, createdById: source.inspectorId, createdAt: now }).returning();
    const dueAt = inspectorAssignmentDueAt(now);
    await tx.insert(inspectorTaskLinksTable).values({ taskId: task.id, sourceMessageId: messageId, conversationId: source.conversationId, inspectorId: source.inspectorId, supervisorId, assignmentMethod: selection.method, assignmentDistanceMeters: selection.distanceMeters, dueAt, targetLatitude: extractInspectorTargetCoordinates(source.body)?.latitude ?? null, targetLongitude: extractInspectorTargetCoordinates(source.body)?.longitude ?? null });
    await tx.insert(inspectorTaskAssignmentHistoryTable).values({ taskId: task.id, assignedStaffId: selection.staffId, assignedById: supervisorId, event: "assigned", method: selection.method, distanceMeters: selection.distanceMeters, provenance: "inbound_inspector_email" });
    const managers = await tx.select({ id: staffTable.id }).from(staffTable).where(and(inArray(staffTable.role, ["supervisor", "admin"]), eq(staffTable.active, true), eq(staffTable.loginEnabled, true)));
    await tx.insert(notificationsTable).values([...managers.map((m: any) => ({ staffId: m.id, type: "direct_alert" as const, message: "URGENT inspector assignment: 15-minute SLA", isRead: false })), { staffId: selection.staffId, type: "direct_alert", message: "URGENT inspector task assigned: complete within 15 minutes.", isRead: false }]);
    return { status: "assigned" as const, taskId: task.id, areaId: match.areaId, assignedStaffId: selection.staffId, dueAt };
  });
}

/** One-time, lock-protected overdue escalation with append-only reassignment history. */
export async function sweepOverdueInspectorAssignments(now = new Date()) {
  // Never reassign before the exact SLA deadline. The locked nullable marker
  // makes this a one-time transition across concurrent scheduler instances.
  const due = await db.select({ taskId: inspectorTaskLinksTable.taskId }).from(inspectorTaskLinksTable).innerJoin(tasksTable, eq(tasksTable.id, inspectorTaskLinksTable.taskId)).where(and(isNull(inspectorTaskLinksTable.escalatedAt), lte(inspectorTaskLinksTable.dueAt, now), eq(tasksTable.completed, false)));
  for (const item of due) await db.transaction(async (tx) => {
    const [link] = await tx.select().from(inspectorTaskLinksTable).where(eq(inspectorTaskLinksTable.taskId, item.taskId)).for("update");
    const [task] = await tx.select().from(tasksTable).where(eq(tasksTable.id, item.taskId)).for("update");
    if (!link || !task || task.completed || link.escalatedAt) return;
    const candidates = await roster(tx, task.areaId, task.taskDate);
    const selected = selectAssignedStaff(candidates, link.targetLatitude === null || link.targetLongitude === null ? null : { latitude: link.targetLatitude, longitude: link.targetLongitude }, now, new Set(task.assignedToId ? [task.assignedToId] : []));
    await tx.update(inspectorTaskLinksTable).set({ escalatedAt: now, escalationStaffId: selected?.staffId ?? null }).where(and(eq(inspectorTaskLinksTable.taskId, task.id), isNull(inspectorTaskLinksTable.escalatedAt)));
    if (selected) { await tx.update(tasksTable).set({ assignedToId: selected.staffId }).where(eq(tasksTable.id, task.id)); await tx.insert(inspectorTaskAssignmentHistoryTable).values({ taskId: task.id, assignedStaffId: selected.staffId, assignedById: link.supervisorId, event: "reassigned", method: selected.method, distanceMeters: selected.distanceMeters, provenance: "overdue_sla_escalation" }); }
    const managers = await tx.select({ id: staffTable.id }).from(staffTable).where(and(inArray(staffTable.role, ["supervisor", "admin"]), eq(staffTable.active, true), eq(staffTable.loginEnabled, true)));
    if (managers.length) await tx.insert(notificationsTable).values(managers.map((m: any) => ({ staffId: m.id, type: "direct_alert" as const, message: selected ? "URGENT overdue inspector task reassigned." : "URGENT overdue inspector task has no alternate staff.", isRead: false })));
  });
}