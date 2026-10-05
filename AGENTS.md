# Repository workflow

The repository owner has authorized automatic delivery of changes for requested work.

- Implement the requested changes, run relevant tests and build checks, and fix failures introduced by the changes.
- Commit all changes belonging to the requested work, push the commits to GitHub, and merge them into `main` without requesting another confirmation.
- Prefer a pull request for a reviewable change record, and merge it after validation and required GitHub checks pass.
- Do not bypass branch protections, force-push, commit credentials, or include unrelated local changes.
- If access, a failing required check, or a merge conflict prevents delivery, report the specific blocker.
- This rule authorizes source-code delivery. Production database changes and deployments follow the scope of the user's request.

Saved at the owner's explicit request on 2026-10-05.
