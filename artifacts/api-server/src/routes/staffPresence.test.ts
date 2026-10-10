import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createStaffPresenceRouter, type PresenceRow, type PresenceStaff } from "./staffPresence";

const activeStaff = (overrides: Partial<PresenceStaff> = {}): PresenceStaff => ({
  id: 7, role: "staff", active: true, formerEmployee: false, loginEnabled: true, ...overrides,
});

async function serve(actor: PresenceStaff | null, initial: PresenceRow[] = []) {
  let clock = new Date("2026-10-10T12:00:00.000Z");
  const rows = new Map(initial.map(row => [row.staffId, row.lastSeenAt]));
  const writes: number[] = [];
  const app = express();
  app.use(express.json());
  app.use(createStaffPresenceRouter({
    resolveActor: async () => actor,
    now: () => clock,
    store: {
      async record(id) {
        const previous = rows.get(id);
        if (!previous || clock.getTime() - previous.getTime() >= 30_000) {
          rows.set(id, clock);
          writes.push(id);
        }
      },
      async list() {
        return [{ staffId: 7, lastSeenAt: rows.get(7) ?? null }, { staffId: 8, lastSeenAt: rows.get(8) ?? null }];
      },
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
    rows, writes, setNow: (value: string) => { clock = new Date(value); },
  };
}

test("presence read is denied to anonymous, staff and disabled admin accounts", async t => {
  for (const actor of [null, activeStaff(), activeStaff({ role: "admin", loginEnabled: false })]) {
    const server = await serve(actor);
    t.after(server.close);
    const response = await fetch(server.base);
    assert.equal(response.status, actor ? 403 : 401);
  }
});

test("admin presence distinguishes recent, expired and never-seen staff", async t => {
  const server = await serve(activeStaff({ role: "admin" }), [
    { staffId: 7, lastSeenAt: new Date("2026-10-10T11:58:00.000Z") },
    { staffId: 8, lastSeenAt: new Date("2026-10-10T11:57:59.999Z") },
  ]);
  t.after(server.close);
  const response = await fetch(server.base);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const data = await response.json() as { staff: Array<{ staffId: number; activeNow: boolean; lastSeenAt: string | null }> };
  assert.deepEqual(data.staff.map(row => [row.staffId, row.activeNow, row.lastSeenAt]), [
    [7, true, "2026-10-10T11:58:00.000Z"],
    [8, false, "2026-10-10T11:57:59.999Z"],
  ]);
});

test("heartbeat derives actor, ignores supplied identity/time, rejects disabled accounts, and atomically throttles tabs", async t => {
  const server = await serve(activeStaff());
  t.after(server.close);
  const headers = { "content-type": "application/json" };
  const send = (body: object) => fetch(`${server.base}/activity`, { method: "POST", headers, body: JSON.stringify(body) });
  assert.equal((await send({ staffId: 999, lastSeenAt: "2000-01-01" })).status, 204);
  assert.deepEqual(server.writes, [7]);
  assert.equal(server.rows.get(7)?.toISOString(), "2026-10-10T12:00:00.000Z");
  await Promise.all([send({ staffId: 999 }), send({ staffId: 999 })]);
  assert.deepEqual(server.writes, [7], "concurrent tabs share the server-side 30-second write limit");
  server.setNow("2026-10-10T12:00:30.000Z");
  await send({ staffId: 999 });
  assert.deepEqual(server.writes, [7, 7]);
  for (const actor of [
    activeStaff({ active: false }),
    activeStaff({ formerEmployee: true }),
    activeStaff({ loginEnabled: false }),
  ]) {
    const blocked = await serve(actor);
    t.after(blocked.close);
    assert.equal((await fetch(`${blocked.base}/activity`, { method: "POST" })).status, 403);
    assert.deepEqual(blocked.writes, []);
  }
});
