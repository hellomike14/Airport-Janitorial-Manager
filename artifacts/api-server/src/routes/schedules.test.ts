import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { type AddressInfo } from "node:net";
import { areasTable, assignmentsTable, schedulesTable, staffTable } from "@workspace/db/schema";
import { createGroupScheduleMoveRouter, createSchedulesRouter } from "./schedules";
import { createAssignmentsRouter } from "./assignments";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

type Row = { id: number; staffId: number; areaId: number; dayOfWeek: number; startTime: string; endTime: string; notes: string | null; updatedAt: Date; staffName: string; areaName: string };

test("weekly schedule reads are scoped to staff, while supervisors and admins can filter or view all", async () => {
  let actor: { id: number; role: "staff" | "supervisor" | "admin" | "inspector" } | null = null;
  let reads = 0;
  const rows = [
    { id: 101, staffId: 7, dayOfWeek: 1, startTime: "08:00" },
    { id: 102, staffId: 8, dayOfWeek: 2, startTime: "09:00" },
  ];
  const dialect = new PgDialect();
  const database = {
    select: () => ({
      from(table: unknown) {
        assert.equal(table, schedulesTable);
        reads++;
        let filterId: number | undefined;
        const query = {
          leftJoin: () => query,
          where: (condition: SQL) => {
            const { sql, params } = dialect.sqlToQuery(condition);
            assert.match(sql, /"schedules"."staff_id" = \$1/);
            assert.equal(params.length, 1);
            filterId = params[0] as number;
            return query;
          },
          orderBy: () => query,
          then: (resolve: (value: typeof rows) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(filterId === undefined ? rows : rows.filter((row) => row.staffId === filterId)).then(resolve, reject),
        };
        return query;
      },
    }),
  };
  const app = express();
  app.use("/api/schedules", createSchedulesRouter(database as never, (async () => actor) as never));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/schedules`;
  const check = async (suffix: string, status: number, expectedIds?: number[]) => {
    const response = await fetch(`${base}${suffix}`);
    assert.equal(response.status, status, `${actor?.role ?? "unauthenticated"} ${suffix}`);
    if (expectedIds) {
      const result = await response.json() as typeof rows;
      assert.deepEqual(result.map((row) => row.id), expectedIds);
    }
  };
  try {
    await check("", 401);
    await check("?staffId=7", 401);
    assert.equal(reads, 0, "unauthenticated requests cannot query schedules");
    actor = { id: 7, role: "staff" };
    await check("", 200, [101]);
    await check("?staffId=7", 200, [101]);
    const staffReads = reads;
    await check("?staffId=8", 403);
    await check("?staffId=0", 400);
    await check("?staffId=not-a-number", 400);
    assert.equal(reads, staffReads, "invalid and forbidden staff requests cannot query schedules");
    actor = { id: 7, role: "inspector" };
    await check("", 403);
    await check("?staffId=7", 403);
    await check("?staffId=8", 403);
    assert.equal(reads, staffReads, "inspectors cannot query schedules");
    for (const role of ["supervisor", "admin"] as const) {
      actor = { id: 7, role };
      await check("", 200, [101, 102]);
      await check("?staffId=7", 200, [101]);
      await check("?staffId=8", 200, [102]);
      await check("?staffId=0", 400);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test("direct schedule writers require a supervisor or admin before validation or database writes", async () => {
  let role: "staff" | "supervisor" | "admin" | null = null;
  let transactions = 0;
  const database = {
    transaction: async () => {
      transactions++;
      throw new Error("Unauthorized request reached the database");
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/schedules", createSchedulesRouter(database as never, (async () => role ? { id: 7, role } : null) as never));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/schedules`;
  const writes = [
    { method: "POST", path: "/", body: {} },
    { method: "POST", path: "/bulk", body: { schedules: [] } },
    { method: "PUT", path: "/123", body: {} },
    { method: "DELETE", path: "/123" },
    { method: "DELETE", path: "/staff/7/clear" },
  ] as const;
  const send = (write: typeof writes[number]) => fetch(`${base}${write.path}`, {
    method: write.method,
    ...("body" in write ? { headers: { "content-type": "application/json" }, body: JSON.stringify(write.body) } : {}),
  });
  try {
    for (const deniedRole of [null, "staff"] as const) {
      role = deniedRole;
      for (const write of writes) {
        const response = await send(write);
        assert.equal(response.status, deniedRole === null ? 401 : 403, `${deniedRole ?? "unauthenticated"} ${write.method} ${write.path}`);
        assert.deepEqual(await response.json(), {
          error: deniedRole === null ? "Login session required" : "Supervisor access required",
        });
      }
    }
    assert.equal(transactions, 0, "denied writes must not reach the database");
    for (const allowedRole of ["supervisor", "admin"] as const) {
      role = allowedRole;
      const response = await send(writes[1]);
      assert.equal(response.status, 200, `${allowedRole} can use the bulk writer`);
      assert.deepEqual(await response.json(), []);
    }
    assert.equal(transactions, 0, "empty bulk create does not start a transaction");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test("reviewed weekly move authorizes supervisors, rejects stale/overlapping reviews and changes only schedule owners", async () => {
  // All tables here are in-memory fixtures, not the existing site database.
  const area = { id: 987654, name: "Weekly move fixture", terminal: "Terminal A - East", location: "Fixture" };
  const first = (): Row => ({ id: 1001, staffId: 11, areaId: area.id, dayOfWeek: 1, startTime: "06:15", endTime: "13:45", notes: "Keep this note", updatedAt: new Date("2026-01-01"), staffName: "Original", areaName: area.name });
  const second = (): Row => ({ ...first(), id: 1002, staffId: 12, dayOfWeek: 2, startTime: "14:00", endTime: "21:00", notes: null, staffName: "Second" });
  let rows = [first(), second()];
  const datedAssignments = [{ areaId: area.id, staffId: 11, assignmentDate: "2099-01-03" }];
  const datedTasks = [{ areaId: area.id, assignedToId: 11, taskDate: "2099-01-03" }];
  const originalAssignments = structuredClone(datedAssignments);
  const originalTasks = structuredClone(datedTasks);
  let reads = 0;
  const fakeDatabase = {
    select: () => ({
      from(table: unknown) {
        const result = () => {
          reads++;
          if (table === staffTable) return [{ id: 99, active: true, formerEmployee: false }];
          if (table === areasTable) return [area];
          if (table === schedulesTable) return rows.map((row) => ({ ...row }));
          throw new Error("Unexpected table");
        };
        const query = {
          where: () => query,
          innerJoin: () => query,
          for: () => query,
          then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve().then(result).then(resolve, reject),
        };
        return query;
      },
    }),
    execute: async () => {},
    update: (table: unknown) => {
      assert.equal(table, schedulesTable);
      return {
        set(values: { staffId: number; updatedAt: Date }) {
          return { where: async () => { rows = rows.map((row) => ({ ...row, ...values })); } };
        },
      };
    },
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(fakeDatabase),
  };
  let role: "staff" | "supervisor" | "admin" | null = null;
  const app = express();
  app.use(express.json());
  app.use("/api/schedules", createGroupScheduleMoveRouter(
    fakeDatabase as never,
    (async () => role ? { id: 7, role } : null) as never,
  ));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/schedules/group/preview`;
  const preview = () => fetch(`${base}?groupKey=terminal-a-east&staffId=99`);
  const save = (snapshot: string) => fetch(base, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ groupKey: "terminal-a-east", staffId: 99, snapshot }),
  });
  try {
    assert.equal((await preview()).status, 401);
    assert.equal((await save("x".repeat(64))).status, 401);
    role = "staff";
    assert.equal((await preview()).status, 403);
    assert.equal((await save("x".repeat(64))).status, 403);
    assert.equal(reads, 0, "unauthorized users cannot inspect schedules");

    role = "supervisor";
    const review = await preview();
    assert.equal(review.status, 200);
    const initial = await review.json() as { snapshot: string; conflict: boolean; rows: Row[] };
    assert.equal(initial.conflict, false);
    assert.deepEqual(initial.rows.map(({ startTime, endTime }) => [startTime, endTime]), [["06:15", "13:45"], ["14:00", "21:00"]]);
    rows[0] = { ...rows[0], notes: "Edited since review", updatedAt: new Date("2026-01-02") };
    assert.equal((await save(initial.snapshot)).status, 409, "edits invalidate review");
    assert.equal(rows[0].staffId, 11);

    const edited = await (await preview()).json() as { snapshot: string };
    rows.push({ ...first(), id: 1003, dayOfWeek: 3 });
    assert.equal((await save(edited.snapshot)).status, 409, "new rows invalidate review");
    rows.pop();
    rows = [first(), second(), { ...first(), id: 1004, staffId: 99, staffName: "Target" }];
    const overlapping = await (await preview()).json() as { snapshot: string; conflict: boolean };
    assert.equal(overlapping.conflict, true);
    assert.equal((await save(overlapping.snapshot)).status, 409, "target area/weekday overlap cannot save");
    assert.equal(rows[0].staffId, 11);

    rows = [first(), second()];
    role = "admin";
    const ready = await (await preview()).json() as { snapshot: string; conflict: boolean };
    assert.equal(ready.conflict, false);
    const saved = await save(ready.snapshot);
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { movedCount: 2 });
    assert.deepEqual(rows.map(({ staffId, dayOfWeek, startTime, endTime, notes }) => ({ staffId, dayOfWeek, startTime, endTime, notes })), [
      { staffId: 99, dayOfWeek: 1, startTime: "06:15", endTime: "13:45", notes: "Keep this note" },
      { staffId: 99, dayOfWeek: 2, startTime: "14:00", endTime: "21:00", notes: null },
    ]);
    assert.deepEqual(datedAssignments, originalAssignments);
    assert.deepEqual(datedTasks, originalTasks);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test("a simultaneous schedule edit or insert cannot slip past group confirmation", async () => {
  for (const change of ["edit", "insert"] as const) {
    const area = { id: 987655, name: "Concurrent move fixture", terminal: "Terminal A - East", location: "Fixture" };
    const first: Row = {
      id: 1001, staffId: 11, areaId: area.id, dayOfWeek: 1,
      startTime: "06:15", endTime: "13:45", notes: null,
      updatedAt: new Date("2026-01-01"), staffName: "Original", areaName: area.name,
    };
    let rows = [first];
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    let writerPaused!: () => void;
    const paused = new Promise<void>((resolve) => { writerPaused = resolve; });
    let confirmationWaiting!: () => void;
    const waiting = new Promise<void>((resolve) => { confirmationWaiting = resolve; });
    const dialect = new PgDialect();
    const held = new Map<string, Promise<void>>();
    let lockAttempts = 0;
    const database = {
      select: () => ({
        from(table: unknown) {
          const read = () => {
            if (table === staffTable) return [{ id: 99, active: true, formerEmployee: false }];
            if (table === areasTable) return [area];
            if (table === schedulesTable) return rows.map((row) => ({ ...row }));
            throw new Error("Unexpected table");
          };
          const query = {
            where: () => query, innerJoin: () => query, for: () => query,
            then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve().then(read).then(resolve, reject),
          };
          return query;
        },
      }),
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        const releases: Array<() => void> = [];
        const tx = {
          ...database,
          execute: async (query: SQL) => {
            const { sql, params } = dialect.sqlToQuery(query);
            assert.match(sql, /pg_advisory_xact_lock/);
            const key = String(params[0]);
            const previous = held.get(key);
            let release!: () => void;
            held.set(key, new Promise<void>((resolve) => { release = resolve; }));
            // The confirming request tries this lock while the writer holds it.
            if (key === "schedule:terminal-a-east" && ++lockAttempts === 2) confirmationWaiting();
            if (previous) await previous;
            releases.push(release);
          },
          insert: (table: unknown) => {
            assert.equal(table, schedulesTable);
            return {
              values(values: { staffId: number; areaId: number; dayOfWeek: number; startTime: string; endTime: string; notes: string | null }) {
                return { returning: async () => {
                  writerPaused();
                  await writeGate;
                  const row = { ...first, ...values, id: 1002 };
                  rows.push(row);
                  return [row];
                } };
              },
            };
          },
          update: (table: unknown) => {
            assert.equal(table, schedulesTable);
            return {
              set(values: Partial<Row>) {
                return { where: () => ({ returning: async () => {
                  writerPaused();
                  await writeGate;
                  rows = rows.map((row) => ({ ...row, ...values }));
                  return rows;
                } }) };
              },
            };
          },
        };
        try {
          return await callback(tx);
        } finally {
          for (const release of releases) release();
        }
      },
    };
    const app = express();
    app.use(express.json());
    app.use("/api/schedules", createSchedulesRouter(database as never, (async () => ({ id: 7, role: "supervisor" })) as never));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/schedules`;
    try {
      const { snapshot } = await (await fetch(`${base}/group/preview?groupKey=terminal-a-east&staffId=99`)).json() as { snapshot: string };
      const writer = change === "edit"
        ? fetch(`${base}/1001`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ notes: "Concurrent edit" }) })
        : fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
          staffId: 12, areaId: area.id, dayOfWeek: 2, startTime: "14:00", endTime: "22:00",
        }) });
      await paused;
      const confirmation = fetch(`${base}/group/preview`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupKey: "terminal-a-east", staffId: 99, snapshot }),
      });
      await Promise.race([waiting, new Promise((_, reject) => setTimeout(() => reject(new Error("confirmation did not reach the group lock")), 3000))]);
      let confirmed = false;
      void confirmation.then(() => { confirmed = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(confirmed, false, "confirmation waits for the schedule writer");
      releaseWrite();
      assert.equal((await writer).status, 200);
      assert.equal((await confirmation).status, 409, `${change} invalidates the reviewed snapshot`);
      assert.equal(rows[0].staffId, 11, "confirmation must not move rows after a concurrent change");
      if (change === "insert") assert.equal(rows.length, 2, "the inserted row remains owned by its creator");
    } finally {
      releaseWrite();
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  }
});

test("assignment-created schedules serialize with a reviewed move in either lock order", async () => {
  for (const [assignmentRoute, firstRequest] of [
    ["single", "assignment"], ["single", "confirmation"],
    ["group", "assignment"], ["group", "confirmation"],
  ] as const) {
    const area = { id: 987656, name: "Assignment race fixture", terminal: "Terminal A - East", location: "Fixture", archived: false };
    const assignmentDate = "2099-01-05";
    const dayOfWeek = new Date(`${assignmentDate}T12:00:00`).getDay();
    const original: Row = {
      id: 1001, staffId: 11, areaId: area.id, dayOfWeek,
      startTime: "06:15", endTime: "13:45", notes: null,
      updatedAt: new Date("2026-01-01"), staffName: "Original", areaName: area.name,
    };
    let rows = [original];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstPaused!: () => void;
    const paused = new Promise<void>((resolve) => { firstPaused = resolve; });
    let secondWaiting!: () => void;
    const waiting = new Promise<void>((resolve) => { secondWaiting = resolve; });
    const dialect = new PgDialect();
    const held = new Map<string, Promise<void>>();
    let scheduleLockAttempts = 0;
    const database = {
      select: (fields: Record<string, unknown>) => ({
        from(table: unknown) {
          const read = async (forUpdate: boolean) => {
            if (forUpdate && firstRequest === "confirmation" && table === schedulesTable) {
              firstPaused();
              await firstGate;
            }
            const data = table === staffTable
              ? [{ id: 99, name: "Target", active: true, formerEmployee: false }, { id: 12, name: "Assigned", active: true, formerEmployee: false }]
              : table === areasTable ? [area]
              : table === assignmentsTable ? []
              : table === schedulesTable && (Object.keys(fields).join(",") === "id" ||
                  Object.keys(fields).join(",") === "areaId" ||
                  Object.keys(fields).join(",") === "startTime,endTime")
                ? rows.filter((row) => row.staffId === 12)
              : table === schedulesTable ? rows
              : (() => { throw new Error("Unexpected table"); })();
            return data.map((item) => {
              const record = item as Record<string, unknown>;
              return Object.fromEntries(Object.keys(fields).map((key) => [
                key, key === "staffName" ? record.staffName : key === "areaName" ? area.name : record[key],
              ]));
            });
          };
          let lockedRead = false;
          const query = {
            where: () => query, innerJoin: () => query,
            for: () => { lockedRead = true; return query; },
            limit: () => query,
            then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
              read(lockedRead).then(resolve, reject),
          };
          return query;
        },
      }),
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        const releases: Array<() => void> = [];
        const tx = {
          ...database,
          execute: async (query: SQL) => {
            const { sql, params } = dialect.sqlToQuery(query);
            assert.match(sql, /pg_advisory_xact_lock/);
            const key = String(params[0]);
            const previous = held.get(key);
            let release!: () => void;
            held.set(key, new Promise<void>((resolve) => { release = resolve; }));
            if (key === "schedule:terminal-a-east" && ++scheduleLockAttempts === 2) secondWaiting();
            if (previous) await previous;
            releases.push(release);
          },
          insert: (table: unknown) => ({
            values: (values: Record<string, unknown>) => {
              if (table === assignmentsTable) {
                return {
                  returning: async () => [{ ...values, id: 2001, createdAt: new Date("2026-01-01") }],
                  then: (resolve: (value: unknown) => unknown) => resolve(undefined),
                };
              }
              assert.equal(table, schedulesTable);
              return { then: async (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
                try {
                  const schedule = Array.isArray(values) ? values[0] : values;
                  if (firstRequest === "assignment") {
                    firstPaused();
                    await firstGate;
                  }
                  rows.push({ ...original, ...schedule, id: 1002, staffName: "Assigned" } as Row);
                  return resolve(undefined);
                } catch (error) { return reject(error); }
              } };
            },
          }),
          update: (table: unknown) => {
            assert.equal(table, schedulesTable);
            return { set: (values: Partial<Row>) => ({
              where: async () => { rows = rows.map((row) => row.id === original.id ? { ...row, ...values } : row); },
            }) };
          },
        };
        try {
          return await callback(tx);
        } finally {
          for (const release of releases) release();
        }
      },
    };
    const actor = (async () => ({ id: 7, role: "supervisor" })) as never;
    const app = express();
    app.use(express.json());
    app.use("/api/schedules", createGroupScheduleMoveRouter(database as never, actor));
    app.use("/api/assignments", createAssignmentsRouter(database as never, actor));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const within = async <T>(promise: Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          promise,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${assignmentRoute}/${firstRequest}: concurrent requests did not finish`)), 3000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    try {
      const reviewed = await (await fetch(`${origin}/schedules/group/preview?groupKey=terminal-a-east&staffId=99`)).json() as { snapshot: string };
      const confirm = () => fetch(`${origin}/schedules/group/preview`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupKey: "terminal-a-east", staffId: 99, snapshot: reviewed.snapshot }),
      });
      const assign = () => fetch(`${origin}/assignments${assignmentRoute === "group" ? "/group" : ""}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ staffId: 12, ...(assignmentRoute === "group" ? { groupKey: "terminal-a-east" } : { areaId: area.id, assignedById: 7 }), assignmentDate, isSpecial: false }),
      });
      const first = firstRequest === "assignment" ? assign() : confirm();
      await within(paused);
      const second = firstRequest === "assignment" ? confirm() : assign();
      await within(waiting);
      let secondFinished = false;
      void second.then(() => { secondFinished = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(secondFinished, false, "the second request waits for the first transaction's schedule lock");
      releaseFirst();
      assert.equal((await within(first)).status, firstRequest === "assignment" ? 201 : 200);
      assert.equal((await within(second)).status, firstRequest === "assignment" ? 409 : 201);
      assert.equal(rows.length, 2);
      assert.equal(rows[0].staffId, firstRequest === "assignment" ? 11 : 99);
      assert.equal(rows[1].staffId, 12, "the assignment-created row is not silently moved");
    } finally {
      releaseFirst();
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  }
});