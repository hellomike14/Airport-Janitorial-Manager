---
name: Marvol actor sessions
description: How caller identity is authenticated server-side and why client-sent staffId must never be trusted.
---

The gate cookie only proves the shared facility passcode; it does not identify WHO is calling. Caller identity comes from the verified Clerk session: `actorStaffFromRequest` (api-server `lib/actorSession.ts`) resolves the Clerk userId → primary email (short in-memory TTL cache) → active staff record matched case-insensitively by email. PIN login and the signed `marvol_actor` cookie were removed entirely.

**Why:** Identity-sensitive features (messaging) must not trust client-sent staff ids; email is the join key between Clerk accounts and staff records.

**How to apply:** Any endpoint returning or mutating per-person data must resolve the actor via `actorStaffFromRequest` (async) and reject mismatched client-supplied ids. Never issue an identity from an unverified id. Staff without an email on file cannot authenticate.
