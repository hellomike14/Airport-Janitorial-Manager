import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { authDiagnosticEventsTable, staffAccessChangesTable } from "@workspace/db/schema";
import { desc, gte, sql } from "drizzle-orm";
import {
  FixedWindowRateLimiter,
  isClientDiagnosticCode,
  newDiagnosticId,
  recordDiagnostic,
} from "../lib/authDiagnostics";
import { requireStaffRole } from "../middlewares/requireStaffRole";

const router: IRouter = Router();
// Deliberately global: it bounds unauthenticated writes without retaining IPs,
// tokens, email addresses, or any other client identifier.
const clientEventLimiter = new FixedWindowRateLimiter(30, 60_000);

async function recentAccessChanges() {
  const changes = await db.select().from(staffAccessChangesTable)
    .orderBy(desc(staffAccessChangesTable.createdAt))
    .limit(100);
  return changes.map(change => ({
    id: change.id,
    actorName: change.actorName,
    staffName: change.staffName,
    action: change.action,
    createdAt: change.createdAt.toISOString(),
    before: {
      active: change.beforeActive,
      loginEnabled: change.beforeLoginEnabled,
      formerEmployee: change.beforeFormerEmployee,
      hasEmail: change.beforeHasEmail,
    },
    after: {
      active: change.afterActive,
      loginEnabled: change.afterLoginEnabled,
      formerEmployee: change.afterFormerEmployee,
      hasEmail: change.afterHasEmail,
    },
  }));
}

router.post("/events", async (req, res) => {
  if (!clientEventLimiter.take()) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "RATE_LIMITED" });
    return;
  }
  const code = req.body?.code;
  if (!isClientDiagnosticCode(code)) {
    res.status(400).json({ error: "INVALID_DIAGNOSTIC_CODE" });
    return;
  }
  const diagnosticId = newDiagnosticId();
  try {
    await recordDiagnostic(code, "client", diagnosticId);
  } catch {
    res.status(503).json({ error: "DIAGNOSTIC_STORE_UNAVAILABLE", diagnosticId });
    return;
  }
  res.status(201).json({ diagnosticId });
});

router.get("/access-audit", requireStaffRole("admin"), async (_req, res) => {
  res.json(await recentAccessChanges());
});

router.get("/", requireStaffRole("admin"), async (_req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [events, summary, changes] = await Promise.all([
    db.select({
      diagnosticId: authDiagnosticEventsTable.diagnosticId,
      code: authDiagnosticEventsTable.code,
      source: authDiagnosticEventsTable.source,
      createdAt: authDiagnosticEventsTable.createdAt,
    }).from(authDiagnosticEventsTable)
      .orderBy(desc(authDiagnosticEventsTable.createdAt))
      .limit(100),
    db.select({
      code: authDiagnosticEventsTable.code,
      count: sql<number>`count(*)::int`,
    }).from(authDiagnosticEventsTable)
      .where(gte(authDiagnosticEventsTable.createdAt, since))
      .groupBy(authDiagnosticEventsTable.code),
    recentAccessChanges(),
  ]);
  res.json({
    events: events.map(event => ({ ...event, createdAt: event.createdAt.toISOString() })),
    summary,
    accessChanges: changes,
  });
});

export default router;