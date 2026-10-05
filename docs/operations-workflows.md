# Operations workflows

The Operations screen provides timekeeping, safety, supplies, quality checks,
readiness audits, and monthly reports. Staff can clock their own time, report
incidents, and request supplies. Managers review operational records; administrative
actions such as payroll export, badge updates, checklist settings, and shift
consolidation require an administrator.

## Timekeeping and readiness

Clock-in and clock-out use the signed-in employee and server timestamps. Configure
the worksite location, permitted radius, and maximum GPS uncertainty in Readiness
before using timekeeping. The initial location is Orlando International Airport.
Browser location access is required. Payroll exports include only approved,
closed actual time entries, with unpaid breaks deducted. Corrections require a
reason, preserve an audit record, and clear approval. Managers cannot approve
their own time. Wage rates and overtime calculations remain payroll responsibilities.

Area assignments no longer create recurring payroll shifts. Readiness identifies
uncovered areas, former employees on schedules, exact duplicate shifts, missing
email addresses, and legacy checklist duplication. Consolidation combines only
identical employee/day/start/end shifts and retains their original records in the
operations audit. Review and correct other historical records in the existing
staff and scheduling screens; deploying this feature does not silently rewrite them.

## Cleaning, safety, and stock

Long default area checklists are grouped into six duties while retaining the
individual cleaning instructions, including every bin and round. Administrators
can save five to seven tasks per area and require photo evidence. Saved profiles
apply to new daily sheets; existing daily records remain unchanged. Assigned
staff can complete their area tasks. Required evidence must be present before
completion and cannot be removed from a completed task.

Badge records track expiry and return, including former employees. Incident
records capture immediate action and manager resolution. Supply fulfillment
records a stock movement and prevents duplicate fulfillment or negative stock.
Quality inspections contain fifteen checks and a calculated score, with a 90%
target.

## Reports and deployment

Monthly reports aggregate recorded tasks, evidence, incidents, inspections, and
approved hours using Orlando calendar dates. Reports are saved and can be
refreshed by an administrator or printed. Startup and hourly jobs generate the
previous month's report. For a deployment that sleeps, schedule a request to
`POST /api/internal/monthly-operations-report` using the existing internal cron
authentication configuration.

The API applies the checked-in additive operations migration before accepting
requests. The production bundle includes the migration, which is repeatable and
does not remove existing operational history. Deployment requires the existing
database and authentication configuration. Publish the merged `main` checkout
through the existing Replit deployment and verify the Operations screen and API
health after publication.

Validation: `pnpm test:operations` exercises actual Express routes and Drizzle
queries against an isolated PostgreSQL engine, including repeat migration,
authorization, schedules, time approval, stock, photo requirements, and reports.
Use `PORT=5173 BASE_PATH=/ pnpm build` for the full application build.
