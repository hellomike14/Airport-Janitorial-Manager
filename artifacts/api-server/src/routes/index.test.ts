import assert from "node:assert/strict";
import test from "node:test";
import express, { type Request } from "express";
import { once } from "node:events";
import { createStaffRoleGate } from "../middlewares/requireStaffRole";
import { createStaffSessionGate } from "../middlewares/staffSessionGate";
import { mountOnboardingRouter, ONBOARDING_MOUNT_ROLES } from "./index";
import { createOnboardingRouter } from "./onboarding";

test("mounted onboarding route admits employee administrators through session and mount guards", async () => {
  const actor = async (req: Request) => {
    const role = req.header("x-test-role");
    return role ? { role } : null;
  };
  const app = express();
  app.use(express.json());
  app.use(createStaffSessionGate(req => Boolean(req.header("x-test-role")), actor));
  const roleFactory = createStaffRoleGate(actor);
  const child = createOnboardingRouter(roleFactory(...ONBOARDING_MOUNT_ROLES));
  mountOnboardingRouter(app, child, roleFactory);

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/onboarding`;
  try {
    assert.ok(ONBOARDING_MOUNT_ROLES.includes("employee_administrator"));
    assert.equal((await fetch(url, {
      method: "POST",
      headers: { "x-test-role": "employee_administrator", "content-type": "application/json" },
      body: "{}",
    })).status, 400, "employee administrators pass both mounted onboarding role gates");
    assert.equal((await fetch(url, { headers: { "x-test-role": "staff" } })).status, 403);
    assert.equal((await fetch(url)).status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
