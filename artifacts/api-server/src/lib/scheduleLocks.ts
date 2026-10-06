import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { TERMINAL_GROUP_KEYS, type TerminalGroupKey } from "./assignmentGroups";

export function scheduleGroupLock(groupKey: TerminalGroupKey) {
  return sql`SELECT pg_advisory_xact_lock(hashtext(${"schedule:" + groupKey}))`;
}

// Take these before reading or writing any schedule rows. Locking all groups
// also covers an update that changes area, a bulk insert spanning groups, and
// a delete whose affected areas aren't known until after the read. The fixed
// order avoids deadlocks between concurrent multi-group writers.
export async function lockScheduleWrites(tx: { execute: (query: ReturnType<typeof scheduleGroupLock>) => Promise<unknown> }) {
  for (const groupKey of TERMINAL_GROUP_KEYS) {
    await tx.execute(scheduleGroupLock(groupKey));
  }
}

// Startup reconciliations may re-point schedules while changing staff or area
// references. Keep their entire transaction behind the schedule locks, not
// just the individual schedule UPDATE.
export async function withStartupScheduleLocks<T>(
  database: typeof db,
  reconcile: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => {
    await lockScheduleWrites(tx);
    return reconcile(tx);
  });
}