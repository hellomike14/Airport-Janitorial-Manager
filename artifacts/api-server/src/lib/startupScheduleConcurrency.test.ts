import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { type AddressInfo } from "node:net";
import express from "express";
import { eq, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { areasTable, schedulesTable, staffTable } from "@workspace/db/schema";
import { createGroupScheduleMoveRouter } from "../routes/schedules";
import { withStartupScheduleLocks } from "./scheduleLocks";

const dialect = new PgDialect();
const groupLock = "schedule:terminal-a-east";

function deferred() {
  let resolve!: () => void;
  return { promise: new Promise<void>((done) => { resolve = done; }), resolve: () => resolve() };
}

async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("schedule lock race timed out")), 3000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test("staff and area startup cleanup serialize with reviewed schedule moves in both lock orders", async () => {
  const startup = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  assert.equal((startup.match(/withStartupScheduleLocks\(db, async \(tx\) =>/g) ?? []).length, 3,
    "both staff cleanup transactions and the area cleanup transaction use the tested lock boundary");

  for (const kind of ["staff", "area"] as const) {
    for (const first of ["confirmation", "cleanup"] as const) {
      const areas = [
        { id: 1, name: "Legacy", terminal: "Terminal A - East", location: "Fixture" },
        { id: 2, name: "Canonical", terminal: "Terminal A - East", location: "Fixture" },
      ];
      type Schedule = {
        id: number; staffId: number; areaId: number; dayOfWeek: number;
        startTime: string; endTime: string; notes: null; updatedAt: Date;
      };
      let rows: Schedule[] = [{
        id: 1001, staffId: 11, areaId: 1, dayOfWeek: 1,
        startTime: "06:15", endTime: "13:45", notes: null, updatedAt: new Date("2026-01-01"),
      }];
      const releaseFirst = deferred();
      const firstLocked = deferred();
      const secondAttempted = deferred();
      const held = new Map<string, Promise<void>>();
      let attempts = 0;
      const confirmationRead: { rows?: Schedule[] } = {};
      const readSlots = () => confirmationRead.rows?.map(({ staffId, areaId }) => [staffId, areaId]);
      let cleanupWrote = false;

      const database = {
        select: (fields: Record<string, unknown>) => ({
          from(table: unknown) {
            const query = {
              where: () => query, innerJoin: () => query, for: () => query,
              then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
                Promise.resolve().then(() => {
                  const source = table === areasTable ? areas
                    : table === staffTable ? [{ id: 99, name: "Target", active: true, formerEmployee: false }]
                    : table === schedulesTable ? rows : (() => { throw new Error("unexpected select"); })();
                  if (table === schedulesTable && Object.keys(fields).includes("dayOfWeek") && !Object.keys(fields).includes("staffName")) {
                    confirmationRead.rows = rows.map((row) => ({ ...row }));
                  }
                  return source.map((item) => Object.fromEntries(
                    Object.keys(fields).map((key) => [key, key === "staffName" ? "Original" : key === "areaName" ? "Legacy" : (item as Record<string, unknown>)[key]]),
                  ));
                }).then(resolve, reject),
            };
            return query;
          },
        }),
        transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
          const releases: Array<() => void> = [];
          let pending: Schedule[] | undefined;
          const tx = {
            ...database,
            execute: async (query: SQL) => {
              const { sql, params } = dialect.sqlToQuery(query);
              assert.match(sql, /pg_advisory_xact_lock/);
              const key = String(params[0]);
              const prior = held.get(key);
              const release = deferred();
              held.set(key, release.promise);
              if (key === groupLock && ++attempts === 2) secondAttempted.resolve();
              if (prior) await prior;
              releases.push(release.resolve);
              if (key === groupLock && attempts === 1) {
                firstLocked.resolve();
                await releaseFirst.promise;
              }
            },
            update: (table: unknown) => {
              assert.equal(table, schedulesTable);
              return { set: (values: Partial<Schedule>) => ({
                where: async (condition: SQL) => {
                  const { sql, params } = dialect.sqlToQuery(condition);
                  pending ??= rows.map((row) => ({ ...row }));
                  if ("areaId" in values || (kind === "staff" && "staffId" in values && values.staffId === 12)) {
                    cleanupWrote = true;
                  }
                  pending = pending.map((row) => {
                    const match = sql.includes('"schedules"."id"') ? (params as number[]).includes(row.id)
                      : sql.includes('"schedules"."staff_id"') ? row.staffId === params[0]
                      : sql.includes('"schedules"."area_id"') ? row.areaId === params[0] : false;
                    assert.match(sql, /"schedules"\."(id|staff_id|area_id)"/);
                    return match ? { ...row, ...values } : row;
                  });
                },
              }) };
            },
          };
          try {
            const result = await callback(tx);
            if (pending) rows = pending;
            return result;
          } finally {
            for (const release of releases) release();
          }
        },
      };
      const app = express();
      app.use(express.json());
      app.use("/api/schedules", createGroupScheduleMoveRouter(database as never,
        (async () => ({ id: 7, role: "admin" })) as never));
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/schedules/group/preview`;
      let confirmation: Promise<Response> | undefined;
      let cleanup: Promise<unknown> | undefined;
      try {
        const review = await within(fetch(`${url}?groupKey=terminal-a-east&staffId=99`));
        assert.equal(review.status, 200);
        const { snapshot } = await review.json() as { snapshot: string };
        const confirm = () => fetch(url, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ groupKey: "terminal-a-east", staffId: 99, snapshot }),
        });
        const reconcile = () => withStartupScheduleLocks(database as never, async (tx) => {
          if (kind === "staff") {
            // Duplicate-staff startup merge: re-point the loser to the survivor.
            await tx.update(schedulesTable).set({ staffId: 12 }).where(eq(schedulesTable.staffId, 11));
          } else {
            // Legacy-area startup merge: re-point to the canonical area.
            await tx.update(schedulesTable).set({ areaId: 2 }).where(eq(schedulesTable.areaId, 1));
          }
        });
        if (first === "confirmation") confirmation = confirm();
        else cleanup = reconcile();
        await within(firstLocked.promise);
        if (first === "confirmation") cleanup = reconcile();
        else confirmation = confirm();
        await within(secondAttempted.promise);
        assert.equal(cleanupWrote, false, "startup schedule UPDATE cannot run while confirmation owns the lock");
        assert.equal(confirmationRead.rows, undefined, "confirmation cannot read schedules while startup owns the lock");
        releaseFirst.resolve();
        const [response] = await within(Promise.all([confirmation!, cleanup!]));
        assert.equal(response.status, first === "confirmation" ? 200 : 409, `${kind}/${first}`);
        assert.equal(cleanupWrote, true);
        if (first === "confirmation") {
          assert.deepEqual(readSlots(), [[11, 1]],
            "confirmation reads the original snapshot, not an in-flight cleanup");
          assert.equal(rows[0].staffId, 99);
        } else {
          assert.deepEqual(readSlots(),
            kind === "staff" ? [[12, 1]] : [[11, 2]], "confirmation reads the committed cleanup");
          assert.equal(rows[0].staffId, kind === "staff" ? 12 : 11, "stale confirmation moves nothing");
        }
        assert.equal(rows[0].areaId, kind === "area" ? 2 : 1);
      } finally {
        releaseFirst.resolve();
        await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      }
    }
  }
});