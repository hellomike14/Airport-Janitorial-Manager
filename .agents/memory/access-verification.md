---
name: Access verification boundaries
description: Limits of auth tests and safety constraints when applying diagnostic schema changes.
---

Distinguish deterministic service tests and controlled browser checks from real post-publication Clerk sign-in. Mocked identity resolution cannot establish that production authentication works.

**Why:** Development and production use separate auth environments; passing local staff policy tests does not verify the provider-to-app flow.

**How to apply:** Report production checks as pending until performed after publication. Never weaken production auth or change real staff records to make tests pass.

Development Drizzle pushes may ask to truncate existing messaging tables when adding unrelated unique constraints. Do not accept truncation.

**Why:** Those tables contain operational history unrelated to new authentication tables.

**How to apply:** Choose the non-truncating constraint option; if existing duplicate data prevents it, investigate rather than delete data.