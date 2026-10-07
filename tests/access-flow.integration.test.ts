import assert from "node:assert/strict";
import test from "node:test";
import {
  loginEnabledAfterAdminUpdate,
  loginEnabledAfterSeedReconciliation,
} from "../artifacts/api-server/src/lib/staffLoginPolicy";
import {
  canManageAssignments,
  canMutateTask,
  isAssignmentTargetEligible,
} from "../artifacts/api-server/src/lib/workflowPolicies";
import {
  resolveStaffSession,
  type StaffIdentity,
} from "../artifacts/marvol-cleaning/src/lib/resolveStaffSession";

type StaffRecord = StaffIdentity & {
  email: string | null;
  active: boolean;
  loginEnabled: boolean;
  formerEmployee: boolean;
};

type Session = { token: string | null };

/**
 * Deterministic service double for the Clerk-to-staff boundary. It does not
 * claim to authenticate with Clerk. The client resolver and server policy
 * functions under test are production modules; provider tokens and persistence
 * are controlled in memory so denial paths can be repeated without real users.
 */
class ControlledAccessService {
  private readonly tokens = new Map<string, { email: string; expired?: boolean }>();
  private assignments = new Map<number, number>();

  constructor(public staff: StaffRecord[]) {}

  issue(token: string, email: string, expired = false) {
    this.tokens.set(token, { email, expired });
  }

  fetchFor(session: Session): typeof fetch {
    return async () => {
      const account = session.token ? this.tokens.get(session.token) : undefined;
      if (!account || account.expired) {
        return Response.json({ error: "SESSION_EXPIRED" }, { status: 401 });
      }

      const email = account.email.trim().toLowerCase();
      const emailMatch = this.staff.find((person) => person.email?.trim().toLowerCase() === email);
      if (!emailMatch) return Response.json({ error: "NO_STAFF_MATCH" }, { status: 404 });
      if (!emailMatch.active || !emailMatch.loginEnabled || emailMatch.formerEmployee) {
        return Response.json({ error: "STAFF_ACCESS_DISABLED" }, { status: 403 });
      }
      return Response.json({ id: emailMatch.id, name: emailMatch.name, role: emailMatch.role });
    };
  }

  assign(actor: StaffIdentity, targetId: number) {
    const target = this.staff.find((person) => person.id === targetId);
    if (!canManageAssignments(actor) || !target || !isAssignmentTargetEligible(target)) {
      return false;
    }
    this.assignments.set(targetId, actor.id);
    return true;
  }

  hasAssignment(staffId: number) {
    return this.assignments.has(staffId);
  }

  restart() {
    const persistedRows = structuredClone(this.staff);
    for (const row of persistedRows) {
      row.loginEnabled = loginEnabledAfterSeedReconciliation(row);
    }
    return new ControlledAccessService(persistedRows);
  }
}

const currentWorker = (): StaffRecord => ({
  id: 7,
  name: "Controlled Worker",
  role: "staff",
  email: "worker@example.test",
  active: true,
  loginEnabled: true,
  formerEmployee: false,
});

const resolve = (service: ControlledAccessService, session: Session) =>
  resolveStaffSession({
    url: "https://service.invalid/api/staff/me",
    signal: new AbortController().signal,
    timeoutMs: 100,
    fetcher: service.fetchFor(session),
  });

test("verified identity matches email case-insensitively and receives its assignment", async () => {
  const worker = currentWorker();
  const service = new ControlledAccessService([worker]);
  service.issue("valid", "  WORKER@example.test ");

  assert.equal(service.assign({ id: 1, name: "Admin", role: "admin" }, worker.id), true);
  assert.deepEqual(await resolve(service, { token: "valid" }), {
    status: "ok",
    user: { id: worker.id, name: worker.name, role: worker.role },
  });
  assert.equal(service.hasAssignment(worker.id), true);
  assert.equal(canMutateTask(worker, worker.id, false), true);
  assert.equal(canMutateTask({ ...worker, id: 8 }, worker.id, false), false);
});

test("missing and expired sessions fail closed, including after logout", async () => {
  const service = new ControlledAccessService([currentWorker()]);
  service.issue("expired", "worker@example.test", true);

  assert.equal((await resolve(service, { token: null })).status, "expired");
  assert.equal((await resolve(service, { token: "expired" })).status, "expired");

  const session: Session = { token: "valid" };
  service.issue("valid", "worker@example.test");
  assert.equal((await resolve(service, session)).status, "ok");
  session.token = null;
  assert.equal((await resolve(service, session)).status, "expired");
});

test("unknown, disabled, inactive, and former staff identities never resolve", async () => {
  const disabled = { ...currentWorker(), id: 10, email: "disabled@example.test", loginEnabled: false };
  const inactive = { ...currentWorker(), id: 11, email: "inactive@example.test", active: false };
  const former = { ...currentWorker(), id: 12, email: "former@example.test", formerEmployee: true };
  const service = new ControlledAccessService([disabled, inactive, former]);

  for (const email of [
    "unknown@example.test",
    "disabled@example.test",
    "inactive@example.test",
    "former@example.test",
  ]) {
    service.issue(email, email);
    const expected = email === "unknown@example.test" ? "nomatch" : "disabled";
    assert.deepEqual(await resolve(service, { token: email }), { status: expected });
  }
});

test("assignment management and target authorization reject unsafe combinations", () => {
  const worker = currentWorker();
  const disabled = { ...currentWorker(), id: 8, loginEnabled: false };
  const former = { ...currentWorker(), id: 9, formerEmployee: true };
  const inactive = { ...currentWorker(), id: 10, active: false };
  const service = new ControlledAccessService([worker, disabled, former, inactive]);

  assert.equal(service.assign(worker, worker.id), false);
  // Login eligibility does not prevent management from assigning active staff.
  assert.equal(service.assign({ id: 2, name: "Supervisor", role: "supervisor" }, disabled.id), true);
  assert.equal(service.assign({ id: 2, name: "Supervisor", role: "supervisor" }, inactive.id), false);
  assert.equal(service.assign({ id: 1, name: "Admin", role: "admin" }, former.id), false);
  assert.equal(service.assign({ id: 1, name: "Admin", role: "admin" }, worker.id), true);
});

test("administrator-enabled access remains enabled across seed reconciliation restart", async () => {
  const worker = { ...currentWorker(), loginEnabled: false };
  worker.loginEnabled = loginEnabledAfterAdminUpdate(worker, { email: worker.email });
  assert.equal(worker.loginEnabled, true);

  const restarted = new ControlledAccessService([worker]).restart();
  restarted.issue("after-restart", "worker@example.test");
  assert.equal(restarted.staff[0].loginEnabled, true);
  assert.equal((await resolve(restarted, { token: "after-restart" })).status, "ok");

  const former = { ...worker, id: 13, formerEmployee: true };
  const safeRestart = new ControlledAccessService([former]).restart();
  assert.equal(safeRestart.staff[0].loginEnabled, false);
});