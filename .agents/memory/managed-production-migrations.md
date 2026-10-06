---
name: Managed production migrations
description: Why the Operations startup migration is development-only on this managed database.
---

For this managed PostgreSQL app, reconcile requests for repeatable startup migration with Publish-owned production schema changes. Do not reintroduce production runtime DDL when incorporating another branch.

**Why:** The requested Operations integration included additive startup SQL, but Replit-managed production databases prohibit startup DDL. Production must preserve existing operational history and receive additive schema changes through Publish instead.

**How to apply:** Keep development migration repeatable and additive, verify the production schema read-only before serving, and review the development-to-production schema diff for removals or truncation before presenting Publish.
