import assert from "node:assert/strict";
import test from "node:test";
import { AuthServiceUnavailable, withAuthDeadline } from "./authAvailability";
import { createStaffSessionGate } from "../middlewares/staffSessionGate";

test("stalled auth dependencies settle as temporary outages", async () => {
  await assert.rejects(withAuthDeadline(new Promise(() => {}), 5), AuthServiceUnavailable);
  assert.equal(await withAuthDeadline(Promise.resolve("account"), 50), "account");
  await assert.rejects(withAuthDeadline(Promise.reject(new Error("provider down")), 50), /provider down/);
});

test("signed-in staff identity probes reach the missing-account response", async () => {
  let next = false, lookedUp = false;
  const gate = createStaffSessionGate(() => true, async () => { lookedUp = true; return null; });
  await gate({ path: "/staff/me", method: "GET" } as any, {} as any, () => { next = true; });
  assert.equal(next, true);
  assert.equal(lookedUp, false);
});

test("identity probes require a verified session; other private APIs still require staff", async () => {
  for (const [path, signedIn] of [["/staff/me", false], ["/staff", true], ["/conversations", true]] as const) {
    let status = 0, next = false;
    const res = { status: (value: number) => { status = value; return res; }, json: () => {} };
    const gate = createStaffSessionGate(() => signedIn, async () => null);
    await gate({ path, method: "GET" } as any, res as any, () => { next = true; });
    assert.equal(status, 401); assert.equal(next, false);
  }
});

test("temporary resolution failures are not turned into missing-account or unauthorized responses", async () => {
  const gate = createStaffSessionGate(() => true, async () => { throw new AuthServiceUnavailable(); });
  await assert.rejects(gate({ path: "/conversations", method: "GET" } as any, {} as any, () => {}), AuthServiceUnavailable);
});
