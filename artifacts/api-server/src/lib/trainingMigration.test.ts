import test from "node:test";
import assert from "node:assert/strict";
import { applyTrainingMigration } from "./trainingMigration";
test("training production startup is read-only and requires Publish-owned tables", async () => {
  const queries: string[] = [];
  await applyTrainingMigration({ query: async (sql: string) => {
    queries.push(sql); return { rows: [] };
  }} as never, "production");
  assert.equal(queries.length, 1);
  assert.match(queries[0].trim(), /^SELECT/);
  assert.doesNotMatch(queries[0], /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i);
  await assert.rejects(applyTrainingMigration({
    query: async () => ({ rows: [{ name: "training_progress" }] }),
  } as never, "production"), /Publish/);
});
