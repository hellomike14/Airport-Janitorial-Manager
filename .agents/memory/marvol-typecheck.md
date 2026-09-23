---
name: Marvol typecheck quirks
description: Pre-existing typecheck breakage in the pnpm monorepo and the orval query-hook typing pitfall to avoid.
---

# Typecheck baseline

Do not assume root typecheck is broken based on older notes. The root check passed on 2026-09-23; use the current command result rather than the historical error list.

# Orval react-query typing pitfall

The generated `use*` query hooks type their options as `UseQueryOptions` which **requires `queryKey`**. Passing `{ query: { enabled: false } }` (to lazily fetch then `refetch()`) is a TS error in this repo's TS config — and existing code does it widely (that's part of the master breakage). To avoid adding new type debt, call the generated **plain async function** instead (e.g. `getQuickbooksConnectUrl()` rather than `useGetQuickbooksConnectUrl({ query: { enabled: false } })`) for on-demand, button-triggered fetches.

# Orval TS2308 with path+query param operations

An operation with BOTH a path param and query params makes Orval emit two same-named `<OpIdPascal>Params` exports (a zod object in `api-zod/generated/api.ts` and a query-params type in `generated/types/`), breaking the `export *` barrel with TS2308. Fix: add an explicit `export type { XParams } from "./generated/types";` line in `lib/api-zod/src/index.ts` (barrel is hand-maintained; orval only cleans `generated/`).
