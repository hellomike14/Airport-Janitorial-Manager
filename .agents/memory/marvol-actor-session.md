---
name: Marvol actor sessions
description: How caller identity is authenticated server-side and why client-sent staffId must never be trusted.
---

The gate cookie only proves the shared facility passcode; it does not identify WHO is calling. A signed HttpOnly `marvol_actor` cookie identifies the logged-in staff member and is minted only after credential verification: PIN verify, or a PIN change proven with the current PIN. First-time PIN enrollment requires an authenticated ADMIN actor session (client-supplied admin PINs are not an authorization credential); the sole exception is bootstrap when no PIN-protected active admin exists. Admin resets of someone else's PIN never mint a session for the admin. Logout clears the cookie server-side.

**Why:** Identity-sensitive features (messaging) must not trust client-sent staff ids, and unauthenticated "account claiming" of PIN-less profiles is an identity takeover.

**How to apply:** Any endpoint returning or mutating per-person data must resolve the actor via `actorIdFromRequest` (api-server `lib/actorSession.ts`) and reject mismatched client-supplied ids. Never issue an identity from an unverified id.
