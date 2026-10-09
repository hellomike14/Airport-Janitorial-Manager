import assert from "node:assert/strict";
import test from "node:test";
import { resolveStaffSession } from "./resolveStaffSession";

const options = () => ({ url: "https://marvol.test/api/staff/me", signal: new AbortController().signal, timeoutMs: 200 });
test("all four staff roles resolve with cookie transport and an uncached request", async () => {
  for (const role of ["admin", "supervisor", "staff", "inspector", "employee_administrator"]) {
    const user = { id: 42, name: "Team member", role };
    const fetcher: typeof fetch = async (_url, init) => {
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.credentials, "same-origin");
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      return Response.json(user);
    };
    assert.deepEqual(await resolveStaffSession({ ...options(), fetcher }), { status: "ok", user });
  }
});
test("documented access failures preserve their reason and diagnostic ID", async () => {
  for (const [http, error, status] of [
    [401, "SESSION_EXPIRED", "expired"],
    [404, "NO_STAFF_MATCH", "nomatch"],
    [403, "STAFF_ACCESS_DISABLED", "disabled"],
    [503, "AUTH_SERVICE_UNAVAILABLE", "unavailable"],
  ] as const) {
    const result = await resolveStaffSession({
      ...options(),
      fetcher: async () => Response.json({ error, diagnosticId: `diag-${http}` }, { status: http }),
    });
    assert.deepEqual(result, { status, diagnosticId: `diag-${http}` });
  }
});
test("undocumented or mismatched HTTP failures remain generic", async () => {
  for (const response of [
    new Response(null, { status: 500 }),
    Response.json({ error: "NO_STAFF_MATCH", diagnosticId: "wrong-status" }, { status: 403 }),
  ]) {
    assert.deepEqual(
      await resolveStaffSession({ ...options(), fetcher: async () => response.clone() }),
      response.status === 403 ? { status: "error", diagnosticId: "wrong-status" } : { status: "error" },
    );
  }
});
test("network failures and stale HTML responses never leave login loading", async () => {
  for (const fetcher of [async () => { throw new Error("offline"); }, async () => new Response("<html>old cached app</html>"), async () => Response.json({ role: "admin" })]) {
    assert.deepEqual(await resolveStaffSession({ ...options(), fetcher }), { status: "error" });
  }
});
test("hung network and response-body waits settle as staff lookup timeouts", async () => {
  const never = () => new Promise<never>(() => {});
  assert.deepEqual(await resolveStaffSession({ ...options(), fetcher: never, timeoutMs: 5 }), { status: "unavailable", reason: "timeout" });
  assert.deepEqual(await resolveStaffSession({ ...options(), fetcher: async () => ({ ok: true, status: 200, json: never }) as any, timeoutMs: 5 }), { status: "unavailable", reason: "timeout" });
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
