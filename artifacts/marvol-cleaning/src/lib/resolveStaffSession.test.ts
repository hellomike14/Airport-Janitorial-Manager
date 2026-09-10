import assert from "node:assert/strict";
import test from "node:test";
import { resolveStaffSession } from "./resolveStaffSession";

const options = () => ({ url: "https://marvol.test/api/staff/me", getToken: async () => "verified-session-token", signal: new AbortController().signal, timeoutMs: 200 });
test("all four staff roles resolve using the verified session and uncached request", async () => {
  for (const role of ["admin", "supervisor", "staff", "inspector"]) {
    const user = { id: 42, name: "Team member", role };
    const fetcher: typeof fetch = async (_url, init) => {
      assert.equal(init?.cache, "no-store");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer verified-session-token");
      return Response.json(user);
    };
    assert.deepEqual(await resolveStaffSession({ ...options(), fetcher }), { status: "ok", user });
  }
});
test("HTTP failures settle into distinct recovery states", async () => {
  for (const [code, status] of [[401, "expired"], [404, "nomatch"], [403, "error"], [500, "error"], [503, "error"]] as const) {
    assert.deepEqual(await resolveStaffSession({ ...options(), fetcher: async () => new Response(null, { status: code }) }), { status });
  }
});
test("network failures and stale HTML responses never leave login loading", async () => {
  for (const fetcher of [async () => { throw new Error("offline"); }, async () => new Response("<html>old cached app</html>"), async () => Response.json({ role: "admin" })]) {
    assert.deepEqual(await resolveStaffSession({ ...options(), fetcher }), { status: "error" });
  }
});
test("an expired cached token is refreshed once before asking the user to sign in", async () => {
  const refreshes: boolean[] = [];
  const user = { id: 42, name: "Manager", role: "admin" };
  const result = await resolveStaffSession({ ...options(), getToken: async fresh => { refreshes.push(!!fresh); return fresh ? "fresh" : "old"; },
    fetcher: async (_url, init) => new Headers(init?.headers).get("authorization") === "Bearer fresh" ? Response.json(user) : new Response(null, { status: 401 }) });
  assert.deepEqual(result, { status: "ok", user });
  assert.deepEqual(refreshes, [false, true]);
});
test("hung token, network, and response-body waits all time out", async () => {
  const never = () => new Promise<never>(() => {});
  assert.deepEqual(await resolveStaffSession({ ...options(), getToken: never, timeoutMs: 5 }), { status: "error" });
  assert.deepEqual(await resolveStaffSession({ ...options(), fetcher: never, timeoutMs: 5 }), { status: "error" });
  assert.deepEqual(await resolveStaffSession({ ...options(), fetcher: async () => ({ ok: true, status: 200, json: never }) as any, timeoutMs: 5 }), { status: "error" });
});
test("account changes cancel outstanding resolution", async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | undefined;
  const pending = resolveStaffSession({ ...options(), signal: controller.signal, fetcher: async (_url, init) => {
    requestSignal = init?.signal as AbortSignal;
    controller.abort();
    return new Promise<never>(() => {});
  } });
  assert.deepEqual(await pending, { status: "error" });
  assert.equal(requestSignal?.aborted, true);
});
