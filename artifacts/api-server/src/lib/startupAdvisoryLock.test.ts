import assert from "node:assert/strict";
import test from "node:test";
import {
  withPostgresAdvisoryLock,
  type AdvisoryLockClient,
} from "./startupAdvisoryLock";

function createHarness(options?: {
  acquireError?: Error;
  unlockError?: Error;
  unlocked?: boolean;
}) {
  const events: string[] = [];
  const client: AdvisoryLockClient = {
    async query(queryText) {
      if (queryText.includes("pg_advisory_lock(")) {
        events.push("lock");
        if (options?.acquireError) throw options.acquireError;
        return { rows: [{}] };
      }
      events.push("unlock");
      if (options?.unlockError) throw options.unlockError;
      return { rows: [{ unlocked: options?.unlocked ?? true }] };
    },
    release(destroy) {
      events.push(`release:${String(destroy ?? false)}`);
    },
  };
  const pool = {
    async connect() {
      events.push("connect");
      return client;
    },
  };
  return { events, pool };
}

test("holds one checked-out PostgreSQL session for the complete startup callback", async () => {
  const { events, pool } = createHarness();

  const result = await withPostgresAdvisoryLock(pool, "startup-test", async () => {
    events.push("work:start");
    await Promise.resolve();
    events.push("work:end");
    return 42;
  });

  assert.equal(result, 42);
  assert.deepEqual(events, [
    "connect",
    "lock",
    "work:start",
    "work:end",
    "unlock",
    "release:false",
  ]);
});

test("releases the advisory lock when startup work fails", async () => {
  const { events, pool } = createHarness();
  const startupError = new Error("migration failed");

  await assert.rejects(
    withPostgresAdvisoryLock(pool, "startup-test", async () => {
      events.push("work");
      throw startupError;
    }),
    (error) => error === startupError,
  );

  assert.deepEqual(events, [
    "connect",
    "lock",
    "work",
    "unlock",
    "release:false",
  ]);
});

test("destroys a connection instead of pooling it when unlock is not confirmed", async () => {
  const { events, pool } = createHarness({ unlocked: false });

  await assert.rejects(
    withPostgresAdvisoryLock(pool, "startup-test", async () => "done"),
    /did not release startup advisory lock/,
  );

  assert.deepEqual(events, ["connect", "lock", "unlock", "release:true"]);
});

test("destroys a connection when acquiring the lock fails", async () => {
  const acquireError = new Error("connection lost");
  const { events, pool } = createHarness({ acquireError });

  await assert.rejects(
    withPostgresAdvisoryLock(pool, "startup-test", async () => undefined),
    (error) => error === acquireError,
  );

  assert.deepEqual(events, ["connect", "lock", "release:true"]);
});
