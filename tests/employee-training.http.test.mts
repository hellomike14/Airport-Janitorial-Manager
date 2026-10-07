import assert from "node:assert/strict";
import { test, mock, before, after } from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "../lib/db/src/schema/index.ts";
import { employeeTraining } from "../artifacts/api-server/src/lib/employeeTrainingConfig.ts";

// Isolated PostgreSQL + real route queries. No operational records are touched.
const requireDb = createRequire(new URL("../lib/db/package.json", import.meta.url));
const requireApi = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { drizzle } = requireDb("drizzle-orm/pglite");
const express = requireApi("express");
const pg = await PGlite.create();
const db = drizzle(pg, { schema });
const people = [
  { id: 1, name: "Test Manager", role: "admin", active: true, loginEnabled: true, formerEmployee: false },
  { id: 2, name: "Test Supervisor", role: "supervisor", active: true, loginEnabled: true, formerEmployee: false },
  { id: 3, name: "Test Employee", role: "staff", active: true, loginEnabled: true, formerEmployee: false },
  { id: 4, name: "Other Employee", role: "staff", active: true, loginEnabled: true, formerEmployee: false },
  { id: 5, name: "Inactive Employee", role: "staff", active: false, loginEnabled: true, formerEmployee: false },
  { id: 6, name: "Test Inspector", role: "inspector", active: true, loginEnabled: true, formerEmployee: false },
  { id: 7, name: "Login Disabled", role: "staff", active: true, loginEnabled: false, formerEmployee: false },
  { id: 8, name: "Former Active Record", role: "staff", active: true, loginEnabled: true, formerEmployee: true },
];
mock.module(new URL("../lib/db/src/index.ts", import.meta.url).href, { namedExports: { db } });
mock.module(new URL("../artifacts/api-server/src/lib/actorSession.ts", import.meta.url).href, {
  namedExports: { actorStaffFromRequest: async (req: any) =>
    people.find(person => person.id === Number(req.header("x-test-actor")) &&
      person.active && person.loginEnabled && !person.formerEmployee) ?? null },
});
const videoBytes = Buffer.from("0123456789abcdefghij");
mock.module(new URL("../artifacts/api-server/src/lib/objectStorage.ts", import.meta.url).href, {
  namedExports: {
    ObjectNotFoundError: class extends Error {},
    ObjectStorageService: class {
      async getObjectEntityFile() {
        return {
          getMetadata: async () => [{ size: String(videoBytes.length) }],
          createReadStream: ({ start, end }: { start: number; end: number }) =>
            Readable.from(videoBytes.subarray(start, end + 1)),
        };
      }
    },
  },
});
const { default: router } = await import("../artifacts/api-server/src/routes/employeeTraining.ts");
let server: any, origin: string;
before(async () => {
  await pg.exec(`CREATE TABLE staff (id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
    active BOOLEAN NOT NULL, former_employee BOOLEAN NOT NULL DEFAULT false);`);
  for (const person of people) await pg.query(
    "INSERT INTO staff (id,name,role,active,former_employee) VALUES ($1,$2,$3,$4,$5)",
    [person.id, person.name, person.role, person.active, person.formerEmployee]);
  const sql = await readFile(new URL("../lib/db/migrations/20261006_employee_training.sql", import.meta.url), "utf8");
  await pg.exec(sql);
  await pg.exec(sql); // Additive development migration is repeatable.
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  origin = `http://127.0.0.1:${server.address().port}/api/employee-training`;
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pg.close();
});
async function request(path: string, actor = 3, body?: unknown) {
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "x-test-actor": String(actor) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}
const signature = { version: employeeTraining.version, watched: true, understood: true, fullName: "Test Employee" };

test("private training blocks signed-out, inactive, login-disabled and former accounts", async () => {
  for (const actor of [0, 5, 7, 8]) {
    assert.equal((await request("/status", actor)).status, 401);
    assert.equal((await request("/session", actor, {})).status, 401);
    assert.equal((await request("/progress", actor, {
      sessionId: "28a87ef7-4bd4-4c5f-b0b9-fd6a1fac09dd",
      version: employeeTraining.version, position: 0, playing: false, seeking: true, rate: 1,
    })).status, 401);
    assert.equal((await request("/acknowledgment", actor, signature)).status, 401);
    const response = await fetch(origin + "/video", { headers: { "x-test-actor": String(actor), Range: "bytes=0-3" } });
    assert.equal(response.status, 401);
  }
  assert.equal((await request("/status", 6)).status, 200);
  const inspectorVideo = await fetch(origin + "/video", { headers: { "x-test-actor": "6", Range: "bytes=0-3" } });
  assert.equal(inspectorVideo.status, 206);
  assert.equal((await request("/review", 3)).status, 403);
});
test("authorized media supports GET/HEAD, seeking, and invalid-range rejection", async () => {
  const headers = { "x-test-actor": "3", Range: "bytes=5-9" };
  const range = await fetch(origin + "/video", { headers });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), "bytes 5-9/20");
  assert.equal(range.headers.get("cache-control"), "private, no-store");
  assert.equal(await range.text(), "56789");
  const head = await fetch(origin + "/video", { method: "HEAD", headers });
  assert.equal(head.status, 206);
  assert.equal(head.headers.get("content-length"), "5");
  assert.equal(await head.text(), "");
  const invalid = await fetch(origin + "/video", { headers: { ...headers, Range: "bytes=999-" } });
  assert.equal(invalid.status, 416);
  const alternate = await fetch(origin + "/video?format=webm", { headers });
  assert.equal(alternate.status, 206);
  assert.equal(alternate.headers.get("content-type"), "video/webm");
  assert.equal(await alternate.text(), "56789");
  assert.equal((await fetch(origin + "/video?format=other", { headers })).status, 400);
});
test("seek to the end and fabricated progress cannot unlock signing", async () => {
  const session = await request("/session", 3, {});
  const progress = await request("/progress", 3, {
    sessionId: session.data.sessionId, version: employeeTraining.version,
    position: employeeTraining.duration, playing: false, seeking: true, rate: 1,
  });
  assert.equal(progress.data.eligible, false);
  assert.equal(progress.data.watchedSeconds, 0);
  assert.equal((await request("/acknowledgment", 3, signature)).status, 409);
});
test("progress is identity-bound, persisted, and limited to one active session", async () => {
  const first = await request("/session", 3, {});
  const second = await request("/session", 3, {});
  const data = { sessionId: first.data.sessionId, version: employeeTraining.version,
    position: 0, playing: true, seeking: false, rate: 1 };
  assert.equal((await request("/progress", 3, data)).status, 409);
  assert.equal((await request("/progress", 4, { ...data, sessionId: second.data.sessionId })).status, 409);
  assert.equal((await request("/progress", 3, { ...data, sessionId: second.data.sessionId })).status, 200);
  await pg.query("UPDATE training_progress SET updated_at=now()-interval '6 seconds' WHERE staff_id=3");
  const result = await request("/progress", 3, { ...data, sessionId: second.data.sessionId, position: 5 });
  assert.equal(result.data.watchedSeconds, 5);
  assert.equal((await request("/status")).data.watchedSeconds, 5);
  assert.equal((await request("/status", 4)).data.watchedSeconds, 0);

  const recovered = await request("/session", 3, {});
  assert.equal(recovered.data.resumePosition, 4.75);
  assert.equal((await request("/status", 3)).data.watchedSeconds, 5);
  const recoveryBaseline = {
    sessionId: recovered.data.sessionId, version: employeeTraining.version,
    position: recovered.data.resumePosition, playing: false, seeking: true, rate: 1,
  };
  await request("/progress", 3, recoveryBaseline);
  await request("/progress", 3, { ...recoveryBaseline, playing: true, seeking: false });
  await pg.query("UPDATE training_progress SET updated_at=now()-interval '6 seconds' WHERE staff_id=3");
  const replayedGap = await request("/progress", 3, {
    ...recoveryBaseline, position: recovered.data.resumePosition + 5, playing: true, seeking: false,
  });
  assert.equal(replayedGap.data.watchedSeconds, 9.75);

  const staleHeartbeat = await request("/progress", 3, {
    ...recoveryBaseline, position: 1, playing: true, seeking: false,
  });
  assert.equal(staleHeartbeat.data.watchedSeconds, 9.75);
  const row = await pg.query<any>("SELECT last_position FROM training_progress WHERE staff_id=3");
  assert.equal(Number(row.rows[0].last_position), 9.75);
});
test("both confirmations, current version, and the signed-in name are mandatory", async () => {
  await pg.query("UPDATE training_progress SET watched_ranges=$1::jsonb WHERE staff_id=3",
    [JSON.stringify([[0, employeeTraining.duration]])]);
  for (const body of [
    { ...signature, watched: false }, { ...signature, understood: false },
    { ...signature, fullName: "Other Employee" }, { ...signature, version: "old-version" },
    { ...signature, staffId: 4 }, { ...signature, completedAt: "2000-01-01" },
  ]) assert.equal((await request("/acknowledgment", 3, body)).status, 400);
});

test("session resets cannot forgive borrowed watch time", async () => {
  await request("/session", 4, {});
  await pg.query("UPDATE training_progress SET updated_at=now()+interval '5 seconds' WHERE staff_id=4");
  for (let i = 0; i < 5; i++) {
    const session = await request("/session", 4, {});
    const baseline = { sessionId: session.data.sessionId, version: employeeTraining.version,
      position: 0, playing: true, seeking: false, rate: 2 };
    await request("/progress", 4, baseline);
    const advance = await request("/progress", 4, { ...baseline, position: 0.5 });
    assert.equal(advance.data.watchedSeconds, 0);
    assert.equal(advance.data.eligible, false);
  }
});
test("signing is immutable, server-timestamped and duplicate-safe under concurrent saves", async () => {
  const before = Date.now();
  const replies = await Promise.all(Array.from({ length: 3 }, () => request("/acknowledgment", 3, signature)));
  assert.ok(replies.every(reply => reply.status === 200));
  const records = await pg.query<any>("SELECT * FROM training_acknowledgments WHERE staff_id=3");
  assert.equal(records.rows.length, 1);
  const status = (await request("/status")).data;
  assert.equal(status.acknowledgment.signature, "Test Employee");
  assert.equal(status.acknowledgment.version, employeeTraining.version);
  assert.equal(status.acknowledgment.videoSha256, employeeTraining.videoSha256);
  assert.ok(new Date(status.acknowledgment.completedAt).getTime() >= before - 1000);
  const timestamp = status.acknowledgment.completedAt;
  assert.equal((await request("/acknowledgment", 3, signature)).data.acknowledgment.completedAt, timestamp);
  assert.equal((await request("/status", 4)).data.acknowledgment, null);
});
test("prior version attestations are retained, but never complete the current version", async () => {
  await pg.query(`INSERT INTO training_acknowledgments (staff_id,version,training_title,video_sha256,signature,staff_name,
    watched_confirmation,understood_confirmation) VALUES (4,'prior-version','Prior training','prior-sha',
    'Other Employee','Other Employee',true,true)`);
  const own = (await request("/status", 4)).data;
  assert.equal(own.acknowledgment, null);
  assert.equal(own.eligible, false);
  assert.equal(own.history.length, 1);
  const review = (await request("/review", 2)).data;
  const current = review.employees.find((person: any) => person.staffId === 3);
  const prior = review.employees.find((person: any) => person.staffId === 4);
  assert.equal(current.status, "completed");
  assert.equal(prior.status, "pending");
  assert.equal(prior.history[0].version, "prior-version");
  assert.equal((await request("/acknowledgment", 4, { ...signature, fullName: "Other Employee" })).status, 409);
});

test("role matrix lets every active role sign only its own eligible training", async () => {
  const activeStaff = people.filter(person =>
    person.active && person.loginEnabled && !person.formerEmployee);
  for (const person of activeStaff) {
    const other = activeStaff.find(candidate => candidate.id !== person.id)!;
    await pg.query("DELETE FROM training_acknowledgments WHERE staff_id=$1", [person.id]);
    await pg.query("DELETE FROM training_progress WHERE staff_id=$1", [person.id]);

    const status = await request("/status", person.id);
    assert.equal(status.status, 200, `${person.role} can read own training`);
    assert.equal(status.data.staff.id, person.id);
    assert.equal(status.data.staff.name, person.name);

    const media = await fetch(origin + "/video", {
      headers: { "x-test-actor": String(person.id), Range: "bytes=0-3" },
    });
    assert.equal(media.status, 206, `${person.role} can view the training video`);

    const session = await request("/session", person.id, {});
    assert.equal(session.status, 200, `${person.role} can start a watch session`);
    assert.equal(session.data.resumePosition, 0);
    const baseline = await request("/progress", person.id, {
      sessionId: session.data.sessionId, version: employeeTraining.version,
      position: 0, playing: false, seeking: true, rate: 1,
    });
    assert.equal(baseline.status, 200, `${person.role} can submit own progress`);

    // Seed fully watched ranges only in this isolated test database.
    await pg.query("UPDATE training_progress SET watched_ranges=$1::jsonb WHERE staff_id=$2",
      [JSON.stringify([[0, employeeTraining.duration]]), person.id]);
    assert.equal((await request("/status", person.id)).data.eligible, true);
    const ownSignature = {
      version: employeeTraining.version, watched: true, understood: true, fullName: person.name,
    };
    const saved = await request("/acknowledgment", person.id, ownSignature);
    assert.equal(saved.status, 200, `${person.role} can attest to own eligible training`);
    assert.equal(saved.data.acknowledgment.staffId, person.id);
    assert.equal(saved.data.acknowledgment.signature, person.name);

    assert.equal((await request("/acknowledgment", person.id, {
      ...ownSignature, fullName: other.name,
    })).status, 400, `${person.role} cannot attest using another employee's name`);
    assert.equal((await request("/acknowledgment", person.id, {
      ...ownSignature, staffId: other.id,
    })).status, 400, `${person.role} cannot select another employee's record`);
    const attemptedOtherStatus = await request(`/status?staffId=${other.id}`, person.id);
    assert.equal(attemptedOtherStatus.status, 200);
    assert.equal(attemptedOtherStatus.data.staff.id, person.id);

    const review = await request("/review", person.id);
    if (person.role === "admin" || person.role === "supervisor") {
      assert.equal(review.status, 200, `${person.role} retains manager review access`);
      assert.ok(review.data.employees.some((employee: any) => employee.staffId === person.id),
        "manager review includes inspector staff so managers can track all eligible roles");
    } else {
      assert.equal(review.status, 403, `${person.role} cannot read manager review`);
    }
  }
});
