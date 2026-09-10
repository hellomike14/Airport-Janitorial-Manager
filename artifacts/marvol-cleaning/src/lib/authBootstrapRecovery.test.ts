import assert from "node:assert/strict";
import test from "node:test";
import { BOOTSTRAP_RETRY_MS, BOOTSTRAP_SLOW_MS, claimBootstrapRetry, clearBootstrapRetry } from "./authBootstrapRecovery";

function storage() {
  const data = new Map<string, string>([["offline-work", "preserve"]]);
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

test("one automatic reload across remounts and page reloads until Clerk is ready", () => {
  const session = storage();
  assert.equal(claimBootstrapRetry(session), true);
  assert.equal(claimBootstrapRetry(session), false);
  assert.equal(claimBootstrapRetry(session), false);
  clearBootstrapRetry(session);
  assert.equal(claimBootstrapRetry(session), true);
  assert.equal(session.data.get("offline-work"), "preserve");
});

test("blocked or silently ignored browser storage disables automatic reload", () => {
  const blocked = () => { throw new Error("storage disabled"); };
  assert.equal(claimBootstrapRetry({ getItem: blocked, setItem: blocked, removeItem: blocked }), false);
  assert.doesNotThrow(() => clearBootstrapRetry({ getItem: blocked, setItem: blocked, removeItem: blocked }));
  assert.equal(claimBootstrapRetry({ getItem: () => null, setItem: () => {}, removeItem: () => {} }), false);
});

test("slowness is shown before a bounded recovery attempt", () => {
  assert.equal(BOOTSTRAP_SLOW_MS, 15_000);
  assert.equal(BOOTSTRAP_RETRY_MS, 30_000);
});