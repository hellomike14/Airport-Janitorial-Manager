# Access-flow regression and operational verification

## Release gate

Run from the repository root:

```sh
pnpm run verify:access-flow
```

The command runs all API Node tests, the frontend authentication tests, the
controlled access-flow integration suite, workspace typechecking, and the API
and web production builds. Any failure stops the gate.

### What this automates

- Client handling of a valid identity, a missing or expired session, refresh,
  no staff match, malformed responses, timeouts, and account-switch
  cancellation.
- Case-insensitive email matching at the controlled service boundary.
- Denial for inactive, login-disabled, and former staff.
- Logout semantics: after the controlled session token is cleared, staff
  resolution returns `expired`.
- Management-only assignment, eligible assignment targets, and current
  assignee task authorization using production policy functions.
- Persistence of administrator-enabled login through a simulated process
  restart and production seed-reconciliation policy.
- Existing backend regressions plus frontend auth recovery regressions.

The integration suite is a **mocked service test**, not a real Clerk sign-in.
It uses deterministic in-memory staff/session data and an injected fetch
function while exercising production client resolution and server policy
modules. It neither weakens authentication nor asserts that production Clerk
credentials work. A true provider-to-database test needs an explicit app-owned
test seam (or a disposable deployed environment and Clerk test tenant); no app
module was changed to add one.

## Controlled-account browser journey

Use a dedicated non-production environment first. Use disposable records and a
controlled Clerk account that cannot receive operational assignments. Record
the environment, release identifier, tester, UTC time, and result. Never put a
password, token, verification code, or full employee list in the record.

### Preparation

1. Confirm outbound email/SMS/push and scheduled notification workers are
   disabled or routed to a documented sink. Do not trigger real notifications.
2. Create or identify:
   - one controlled admin account;
   - controlled worker A with a unique test email;
   - controlled worker B with a second unique test email;
   - a disposable task/assignment fixture.
3. Capture the original values for every record that will be changed. Do not
   repurpose a real employee or a live operational assignment.

### Journey

1. In a private browser session, sign in as worker A through the real Clerk UI.
   Confirm the application identifies worker A and only A's assignment is
   visible.
2. Open the disposable assignment and verify permitted worker actions. Verify
   worker A cannot use management-only assignment controls.
3. Log out with the application control. Use Back and refresh; private content
   must not reappear and an authenticated API request must require sign-in.
4. Sign in as worker B in the same browser. Confirm no worker A identity,
   assignment, or cached private view remains.
5. Log out, then sign in as the controlled admin. Change worker A's staff email
   to an intentionally wrong unique test address and save. Confirm worker A's
   original Clerk account produces the no-matching-staff path, not a successful
   login.
6. As admin, repair worker A's email by re-entering the exact Clerk email and
   saving once. Confirm the access indicator is active, has an email, and is
   permitted to sign in. This is a one-time repair check, not a recurring login
   procedure.
7. Log out as admin and sign in as worker A. Confirm identity resolution now
   succeeds without another admin save.
8. As admin, assign only the disposable fixture to worker A. Sign in as worker
   A and confirm that assignment is visible and authorized. Confirm worker B
   cannot act on it.
9. Restart only the non-production service through the approved operational
   procedure. Sign in again as worker A and confirm enabled access and the
   disposable assignment survive. Do not treat a page reload as a restart.
10. Mark a disposable staff record disabled/former and confirm its controlled
    account is blocked. Restore only if the fixture's cleanup plan requires it.

### Cleanup

1. Remove the disposable assignment/task and controlled staff records, or
   restore every captured original value.
2. Remove temporary Clerk users/sessions according to the test-tenant policy.
3. Confirm notification queues/sinks contain no pending operational delivery.
4. Record cleanup completion and any diagnostic ID. Do not retain screenshots
   containing private staff data.

## Post-publish verification

Post-publish verification is **pending until an authorized person publishes**.
These instructions do not publish automatically and the automated gate performs
no production writes.

After an approved publication, run a reduced version of the browser journey
with a pre-provisioned controlled production verification account and a
dedicated non-operational assignment fixture. At minimum verify real Clerk
sign-in, correct staff identity, assignment visibility/authorization, logout,
account switch, and sign-in after the approved service restart/deploy. Do not
edit real employee records, do not send real notifications, and do not perform
the email-mismatch repair in production unless the change is explicitly
approved and reversible.

Record pass/fail against the published release. A development or mocked-service
pass is evidence for the code paths only; it is not evidence that live Clerk,
production data, routing, or deployment configuration works.