import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { type AddressInfo } from "node:net";
import { areasTable, schedulesTable, staffTable } from "@workspace/db/schema";
import { createGroupScheduleMoveRouter } from "./schedules";

type Row = { id: number; staffId: number; areaId: number; dayOfWeek: number; startTime: string; endTime: string; notes: string | null; updatedAt: Date; staffName: string; areaName: string };

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