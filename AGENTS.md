# Repository workflow

The repository owner has authorized automatic delivery of changes for requested work.

- Implement the requested changes, run relevant tests and build checks, and fix failures introduced by the changes.
- Commit all changes belonging to the requested work, push the commits to GitHub, and merge them into `main` without requesting another confirmation.
- Prefer a pull request for a reviewable change record, and merge it after validation and required GitHub checks pass.
- After merging each verified change into `main`, publish it to the project's existing configured deployment automatically, without another permission request. The existing app URL supplied by the owner is `https://airport-janitorial-manager.replit.app`.
- Apply required additive migrations through the configured deployment workflow, preserve operational history, and verify that the published app serves the merged version. Do not publish a stale checkout.
- Do not bypass branch protections, force-push, commit credentials, or include unrelated local changes.
- If access, a failing required check, or a merge conflict prevents delivery, report the specific blocker.
- This rule authorizes source-code delivery and publication of the requested changes. It does not authorize destructive database resets or unrelated changes.

Saved at the owner's explicit request on 2026-10-05.
