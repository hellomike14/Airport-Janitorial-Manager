import assert from "node:assert/strict";
import { test, mock, before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "../../lib/db/src/schema/index.ts";
import { orlandoDate } from "../../artifacts/api-server/src/lib/operationsPolicy.ts";

// Exercise the real routes, Drizzle queries and additive SQL migration against
// an isolated PostgreSQL engine. Only the verified Clerk identity is controlled.
// This harness is never imported by the production app.
const requireDb = createRequire(
  new URL("../../lib/db/package.json", import.meta.url),
);
const { drizzle } = requireDb("drizzle-orm/pglite");
const { is, SQL } = requireDb("drizzle-orm");
const { PgTable, getTableConfig, PgDialect } = requireDb("drizzle-orm/pg-core");
const requireApi = createRequire(
  new URL("../../artifacts/api-server/package.json", import.meta.url),
);
const express = requireApi("express");
const pg = await PGlite.create();
const db = drizzle(pg, { schema });
const staff = [
  {
    id: 1,
    name: "Administrator",
    role: "admin",
    active: true,
    loginEnabled: true,
    formerEmployee: false,
  },
  {
    id: 2,
    name: "Supervisor",
    role: "supervisor",
    active: true,
    loginEnabled: true,
    formerEmployee: false,
  },
  {
    id: 3,
    name: "Worker",
    role: "staff",
    active: true,
    loginEnabled: true,
    formerEmployee: false,
  },
  {
    id: 4,
    name: "Other Worker",
    role: "staff",
    active: true,
    loginEnabled: true,
    formerEmployee: false,
  },
  {
    id: 5,
    name: "Former Worker",
    role: "staff",
    active: false,
    loginEnabled: false,
    formerEmployee: true,
  },
  {
    id: 6,
    name: "Inspector",
    role: "inspector",
    active: true,
    loginEnabled: true,
    formerEmployee: false,
  },
];
mock.module(new URL("../../lib/db/src/index.ts", import.meta.url).href, {
  namedExports: { db },
});
mock.module(
  new URL("../../artifacts/api-server/src/lib/actorSession.ts", import.meta.url)
    .href,
  {
    namedExports: {
      actorStaffFromRequest: async (req: any) =>
        staff.find(
          (s) =>
            s.id === Number(req.header("x-test-actor")) &&
            s.active &&
            !s.formerEmployee,
        ) ?? null,
    },
  },
);
const { default: operations } =
  await import("../../artifacts/api-server/src/routes/operations.ts");
const { default: schedules } =
  await import("../../artifacts/api-server/src/routes/schedules.ts");
const { default: assignments } =
  await import("../../artifacts/api-server/src/routes/assignments.ts");
const { default: tasks } =
  await import("../../artifacts/api-server/src/routes/tasks.ts");
let server: any, origin: string;
const q = (text: string, params: unknown[] = []) => pg.query<any>(text, params);
async function request(
  path: string,
  actor = 1,
  method = "GET",
  body?: unknown,
) {
  const res = await fetch(`${origin}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-test-actor": String(actor),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const content = await res.text();
  return {
    status: res.status,
    data: res.headers.get("content-type")?.includes("application/json")
      ? JSON.parse(content)
      : content,
  };
}
const newTables = new Set([
  "time_entries",
  "time_entry_audit",
  "staff_badges",
  "incidents",
  "supply_items",
  "supply_requests",
  "supply_movements",
  "area_checklists",
  "inspections",
  "monthly_reports",
  "operations_settings",
  "operations_audit",
]);
const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
before(async () => {
  // Generate the prior table shape from production schema definitions rather
  // than maintaining a second hand-written copy. New tables are migrated below.
  const dialect = new PgDialect();
  for (const table of Object.values(schema)) {
    if (!is(table, PgTable)) continue;
    const config = getTableConfig(table);
    if (newTables.has(config.name)) continue;
    const columns = config.columns.filter(
      (c: any) => !(config.name === "tasks" && c.name === "photo_required"),
    );
    const definitions = columns.map((c: any) => {
      let def = `${quote(c.name)} ${c.getSQLType()}${c.notNull ? " NOT NULL" : ""}${c.primary ? " PRIMARY KEY" : ""}`;
      if (c.default !== undefined)
        def += ` DEFAULT ${is(c.default, SQL) ? dialect.sqlToQuery(c.default).sql : typeof c.default === "string" ? `'${c.default.replaceAll("'", "''")}'` : JSON.stringify(c.default)}`;
      return def;
    });
    await pg.exec(
      `CREATE TABLE ${quote(config.name)} (${definitions.join(", ")})`,
    );
  }
  const migration = await readFile(
    new URL("../../lib/db/migrations/20261005_operations.sql", import.meta.url),
    "utf8",
  );
  await pg.exec(migration);
  await pg.exec(migration);
  for (const person of staff)
    await q(
      "INSERT INTO staff(id,name,role,active,login_enabled,former_employee) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        person.id,
        person.name,
        person.role,
        person.active,
        person.loginEnabled,
        person.formerEmployee,
      ],
    );
  await q(
    "INSERT INTO areas(id,name,terminal,location) VALUES (1,'Test garage','Terminal A - East','Level 1'),(2,'Uncovered garage','Top Terminal','Level 4')",
  );
  const app = express();
  app.use(express.json());
  // schedules/tasks normally sit behind requireStaffSession in the application.
  app.use(async (req: any, res: any, next: any) => {
    if (
      !(await (
        await import("../../artifacts/api-server/src/lib/actorSession.ts")
      ).actorStaffFromRequest(req))
    )
      return res.status(401).json({ error: "Login required" });
    next();
  });
  app.use("/operations", operations);
  app.use("/schedules", schedules);
  app.use("/assignments", assignments);
  app.use("/tasks", tasks);
  app.use((error: Error, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: error.message });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(resolve));
  await pg.close();
});

test("additive migration is repeatable and denies missing/ineligible/inspector actors", async () => {
  for (const actor of [0, 5])
    assert.equal((await request("/operations/supplies", actor)).status, 401);
  assert.equal((await request("/operations/supplies", 6)).status, 403);
  assert.equal((await request("/operations/settings", 3)).status, 200);
  assert.equal(
    (await request("/operations/settings", 3, "PUT", {})).status,
    403,
  );
});
test("area assignments are idempotent and never create recurring shifts", async () => {
  const body = {
    staffId: 3,
    areaId: 1,
    assignmentDate: orlandoDate(),
    assignedById: 99,
    isSpecial: false,
  };
  const first = await request("/assignments", 2, "POST", body);
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.equal(first.data.assignedById, 2);
  assert.equal(
    (await request("/assignments", 2, "POST", body)).data.id,
    first.data.id,
  );
  assert.equal(
    (await q("SELECT count(*)::int AS n FROM schedules")).rows[0].n,
    0,
  );
  assert.equal(
    (await request("/assignments", 2, "POST", { ...body, staffId: 5 })).status,
    400,
  );
});
test("schedule creation rejects overlaps, partial invalid updates and former staff", async () => {
  const shift = {
    staffId: 3,
    dayOfWeek: 1,
    startTime: "14:00",
    endTime: "22:00",
  };
  const created = await request("/schedules", 2, "POST", shift);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(
    (await request("/schedules", 2, "POST", { ...shift, areaId: 1 })).status,
    409,
  );
  assert.equal(
    (
      await request(`/schedules/${created.data.id}`, 2, "PUT", {
        startTime: "23:00",
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("/schedules", 2, "POST", { ...shift, staffId: 5 })).status,
    409,
  );
  assert.equal((await request("/schedules", 3, "POST", shift)).status, 403);
  assert.equal((await request("/schedules?staffId=4", 3)).status, 403);
  const bulk = await request("/schedules/bulk", 2, "POST", {
    schedules: [
      { ...shift, dayOfWeek: 2 },
      { ...shift, dayOfWeek: 2 },
    ],
  });
  assert.equal(bulk.status, 409);
  assert.equal(
    (await q("SELECT count(*)::int AS n FROM schedules WHERE day_of_week=2"))
      .rows[0].n,
    0,
  );
});
test("GPS clock-in, duplicate protection, break validation, approval and CSV use actual time", async () => {
  assert.equal(
    (
      await request("/operations/time/clock-in", 3, "POST", {
        latitude: 0,
        longitude: 0,
        accuracy: 1,
      })
    ).status,
    400,
  );
  const gps = { latitude: 28.4312, longitude: -81.3081, accuracy: 10 };
  assert.equal(
    (
      await request("/operations/time/clock-in", 3, "POST", {
        ...gps,
        accuracy: 500,
      })
    ).status,
    400,
  );
  const clocked = await request("/operations/time/clock-in", 3, "POST", {
    ...gps,
    staffId: 4,
  });
  assert.equal(clocked.status, 201);
  assert.equal(clocked.data.staffId, 3);
  assert.equal(
    (await request("/operations/time/clock-in", 3, "POST", gps)).status,
    409,
  );
  assert.equal(
    (await request(`/operations/time/${clocked.data.id}/approve`, 2, "POST"))
      .status,
    409,
  );
  await q(
    "UPDATE time_entries SET clock_in=clock_in - interval '8 hours' WHERE id=$1",
    [clocked.data.id],
  );
  assert.equal(
    (
      await request("/operations/time/clock-out", 3, "POST", {
        ...gps,
        breakMinutes: 1000,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/operations/time/clock-out", 3, "POST", {
        ...gps,
        breakMinutes: 30,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(`/operations/time/${clocked.data.id}/approve`, 3, "POST"))
      .status,
    403,
  );
  assert.equal(
    (await request(`/operations/time/${clocked.data.id}/approve`, 2, "POST"))
      .status,
    200,
  );
  const dates = `from=${orlandoDate(new Date(Date.now() - 86400000))}&to=${orlandoDate()}`;
  const csv = await request(`/operations/payroll.csv?${dates}`);
  assert.equal(csv.status, 200);
  assert.match(csv.data, /7\.5000/);
  assert.equal(
    (await request(`/operations/payroll.csv?${dates}`, 3)).status,
    403,
  );
  assert.equal((await request(`/operations/time?${dates}`, 4)).data.length, 0);
  const corrected = await request(
    `/operations/time/${clocked.data.id}/correct`,
    2,
    "PATCH",
    {
      clockIn: new Date(Date.now() - 7 * 3600000).toISOString(),
      clockOut: new Date().toISOString(),
      breakMinutes: 0,
      reason: "Corrected missed start",
    },
  );
  assert.equal(corrected.status, 200);
  assert.equal(corrected.data.approvedAt, null);
  assert.equal(
    (await q("SELECT count(*)::int AS n FROM time_entry_audit")).rows[0].n,
    2,
  );
  assert.doesNotMatch(
    (await request(`/operations/payroll.csv?${dates}`)).data,
    /Worker/,
  );
});
test("supply fulfillment is atomic and repeat attempts cannot deduct twice", async () => {
  const item = await request("/operations/supplies", 2, "POST", {
    name: "Liners",
    unit: "boxes",
    stock: 10,
    reorderLevel: 5,
  });
  assert.equal(item.status, 201);
  const req = await request("/operations/supply-requests", 3, "POST", {
    itemId: item.data.id,
    quantity: 3,
  });
  assert.equal(req.status, 201);
  assert.equal(
    (
      await request(
        `/operations/supply-requests/${req.data.id}/handle`,
        3,
        "POST",
        { status: "fulfilled" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/operations/supply-requests/${req.data.id}/handle`,
        2,
        "POST",
        { status: "fulfilled" },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/operations/supply-requests/${req.data.id}/handle`,
        2,
        "POST",
        { status: "fulfilled" },
      )
    ).status,
    409,
  );
  assert.equal((await request("/operations/supplies", 3)).data[0].stock, 7);
  const tooMany = await request("/operations/supply-requests", 3, "POST", {
    itemId: item.data.id,
    quantity: 99,
  });
  assert.equal(
    (
      await request(
        `/operations/supply-requests/${tooMany.data.id}/handle`,
        2,
        "POST",
        { status: "fulfilled" },
      )
    ).status,
    409,
  );
  assert.equal((await request("/operations/supplies", 3)).data[0].stock, 7);
});
test("badges and incidents preserve staff privacy and record manager resolution", async () => {
  const badge = {
    badgeNumber: "MCO-TEST",
    expiresOn: "2026-12-01",
    returnedOn: null,
  };
  assert.equal(
    (await request("/operations/badges/5", 1, "PUT", badge)).status,
    200,
  );
  assert.equal(
    (await request("/operations/badges", 2)).data[0].returnRequired,
    true,
  );
  assert.equal((await request("/operations/badges", 3)).data.length, 0);
  const incident = await request("/operations/incidents", 3, "POST", {
    areaId: 1,
    category: "spill",
    severity: "high",
    description: "Oil spill",
    immediateAction: "Area cordoned off",
    occurredAt: new Date().toISOString(),
    reportedById: 4,
  });
  assert.equal(incident.status, 201);
  assert.equal(incident.data.reportedById, 3);
  assert.equal((await request("/operations/incidents", 4)).data.length, 0);
  assert.equal(
    (
      await request(
        `/operations/incidents/${incident.data.id}/close`,
        3,
        "POST",
        { resolution: "Cleaned" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/operations/incidents/${incident.data.id}/close`,
        2,
        "POST",
        { resolution: "Cleaned and inspected" },
      )
    ).status,
    200,
  );
});
test("short checklists require evidence, preserve history and allow assigned-area completion", async () => {
  const items = Array.from({ length: 6 }, (_, i) => ({
    taskName: `Routine task ${i}`,
    photoRequired: i === 0,
  }));
  assert.equal(
    (
      await request("/operations/checklists/1", 1, "PUT", {
        items: items.slice(0, 4),
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("/operations/checklists/1", 1, "PUT", { items })).status,
    200,
  );
  const listed = await request(`/tasks?areaId=1&date=${orlandoDate()}`, 3);
  assert.equal(listed.status, 200, JSON.stringify(listed.data));
  assert.equal(listed.data.length, 6);
  const task = listed.data[0];
  assert.equal(task.photoRequired, true);
  assert.equal(
    (
      await request(`/tasks/${task.id}/complete`, 3, "POST", {
        completedById: 3,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`/tasks/${task.id}/complete`, 4, "POST", {
        completedById: 4,
      })
    ).status,
    403,
  );
  await q(
    "UPDATE tasks SET after_image_path='/objects/test-evidence' WHERE id=$1",
    [task.id],
  );
  assert.equal(
    (
      await request(`/tasks/${task.id}/complete`, 3, "POST", {
        completedById: 3,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`/tasks/${task.id}/images`, 3, "PATCH", {
        afterImagePath: null,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("/operations/checklists/1", 1, "PUT", {
        items: items.map((i) => ({ ...i, taskName: i.taskName + " revised" })),
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(`/tasks?areaId=1&date=${orlandoDate()}`, 3)).data[0]
      .taskName,
    task.taskName,
  );
});
test("readiness reports missing coverage; inspection scores and monthly report use saved facts", async () => {
  const audit = await request(`/operations/audit?date=${orlandoDate()}`, 2);
  assert.equal(audit.status, 200);
  assert.equal(audit.data.uncoveredAreas[0].id, 2);
  const inspection = await request("/operations/inspections", 2, "POST", {
    areaId: 1,
    inspectionDate: orlandoDate(),
    checks: Array.from({ length: 15 }, (_, i) => i < 14),
    notes: "One missed drain",
  });
  assert.equal(inspection.status, 201);
  assert.equal(inspection.data.score, 93);
  const month = orlandoDate().slice(0, 7);
  const report = await request(`/operations/monthly-report/${month}`, 2);
  assert.equal(report.status, 200, JSON.stringify(report.data));
  assert.equal(report.data.completedTasks, 1);
  assert.equal(report.data.inspections.passed, 1);
  assert.equal(report.data.incidents.total, 1);
  assert.equal(
    (await request(`/operations/monthly-report/${month}/refresh`, 1, "POST"))
      .status,
    200,
  );
  assert.equal(
    (await q("SELECT count(*)::int AS n FROM monthly_reports")).rows[0].n,
    1,
  );
});

test("exact duplicate consolidation preserves original shifts and is repeatable", async () => {
  await q("INSERT INTO schedules (staff_id, area_id, day_of_week, start_time, end_time, notes) VALUES (4,1,6,'20:00','22:00','First area'),(4,2,6,'20:00','22:00','Second area')");
  assert.equal((await request("/operations/schedules/consolidate", 2, "POST")).status, 403);
  const result = await request("/operations/schedules/consolidate", 1, "POST");
  assert.equal(result.status, 200);
  assert.equal(result.data.removed, 1);
  const saved = (await q("SELECT area_id, notes FROM schedules WHERE staff_id=4 AND day_of_week=6")).rows;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].area_id, null);
  assert.match(saved[0].notes, /First area/);
  assert.match(saved[0].notes, /Second area/);
  const audit = (await q("SELECT details FROM operations_audit WHERE action='consolidated_shifts'")).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].details.originalShifts.length, 2);
  assert.equal((await request("/operations/schedules/consolidate", 1, "POST")).data.removed, 0);
});
