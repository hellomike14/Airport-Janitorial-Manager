import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { staffPresenceTable, staffTable } from "@workspace/db/schema";
import { actorStaffFromRequest } from "../lib/actorSession";

export const STAFF_PRESENCE_ACTIVE_MS = 2 * 60 * 1000;
export const STAFF_PRESENCE_WRITE_INTERVAL_MS = 30 * 1000;

export type PresenceStaff = {
  id: number;
  active: boolean;
  formerEmployee: boolean;
  loginEnabled: boolean;
  role: string;
};
export type PresenceRow = { staffId: number; lastSeenAt: Date | null };
type PresenceStore = {
  record: (staffId: number) => Promise<void>;
  list: () => Promise<PresenceRow[]>;
};
type PresenceDependencies = {
  resolveActor: (req: Parameters<typeof actorStaffFromRequest>[0]) => Promise<PresenceStaff | null>;
  store: PresenceStore;
  now: () => Date;
};

const databaseStore: PresenceStore = {
  async record(staffId) {
    // Atomic database-side throttle shared by every worker and browser tab.
    await db.execute(sql`
      INSERT INTO staff_presence (staff_id, last_seen_at)
      VALUES (${staffId}, now())
      ON CONFLICT (staff_id) DO UPDATE
      SET last_seen_at = now()
      WHERE staff_presence.last_seen_at <= now() - interval '30 seconds'
    `);
  },
  async list() {
    const rows = await db.select({
      staffId: staffTable.id,
      lastSeenAt: staffPresenceTable.lastSeenAt,
    }).from(staffTable)
      .leftJoin(staffPresenceTable, eq(staffPresenceTable.staffId, staffTable.id))
      .where(and(eq(staffTable.active, true), eq(staffTable.formerEmployee, false)))
      .orderBy(staffTable.name);
    return rows;
  },
};

export function createStaffPresenceRouter(
  dependencies: PresenceDependencies = {
    resolveActor: actorStaffFromRequest,
    store: databaseStore,
    now: () => new Date(),
  },
): IRouter {
  const router: IRouter = Router();
  router.get("/", async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const actor = await dependencies.resolveActor(req);
    if (!actor) { res.status(401).json({ error: "Login session required" }); return; }
    if (!actor.active || !actor.loginEnabled || actor.formerEmployee || actor.role !== "admin") {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    const serverNow = dependencies.now();
    const staff = await dependencies.store.list();
    res.json({
      serverNow: serverNow.toISOString(),
      staff: staff.map(({ staffId, lastSeenAt }) => ({
        staffId,
        lastSeenAt: lastSeenAt?.toISOString() ?? null,
        activeNow: lastSeenAt != null &&
          serverNow.getTime() - lastSeenAt.getTime() <= STAFF_PRESENCE_ACTIVE_MS,
      })),
    });
  });
  router.post("/activity", async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "no-store");
    const actor = await dependencies.resolveActor(req);
    if (!actor) { res.status(401).json({ error: "Login session required" }); return; }
    if (!actor.active || !actor.loginEnabled || actor.formerEmployee) {
      res.status(403).json({ error: "Staff access is disabled" });
      return;
    }
    await dependencies.store.record(actor.id);
    res.sendStatus(204);
  });
  return router;
}

export default createStaffPresenceRouter();
