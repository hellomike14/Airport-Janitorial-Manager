import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOperationsMigration } from "./operationsMigration";

test("production startup verifies the schema using only a read query", async () => {
  const queries: string[] = [];
  const database = {
    query: async (query: string) => {
      queries.push(query);
      return { rows: [] };
    },
  };
  await applyOperationsMigration(database as never, "production");
  assert.equal(queries.length, 1);
  assert.match(queries[0].trim(), /^SELECT /);
  assert.doesNotMatch(queries[0], /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  assert.match(queries[0], /tasks\.photo_required/);
});

test("production startup refuses to serve when Publish has not applied the schema", async () => {
  const database = { query: async () => ({ rows: [{ missing: "time_entries" }] }) };
  await assert.rejects(
    applyOperationsMigration(database as never, "production"),
    /Operations schema is missing time_entries.*Publish/,
  );
});
