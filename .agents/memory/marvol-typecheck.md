---
name: Marvol typecheck quirks
description: Pre-existing typecheck breakage in the pnpm monorepo and the orval query-hook typing pitfall to avoid.
---

# Pre-existing typecheck state (Marvol monorepo)

`pnpm run typecheck` at the repo root is RED on master, independent of any new work. Two distinct causes:

1. **Project-reference config error**: `artifacts/marvol-cleaning/tsconfig.json` references `lib/object-storage-web`, but that lib's tsconfig lacks `"composite": true`, so `tsc -p` fails with TS6306 before checking any source. (`lib/api-client-react` is referenced too and is correct — it has `composite: true`, `emitDeclarationOnly`, `declarationMap`.)
2. **Many app-level errors** in existing pages (AreaTasks, Issues, AppLayout, InspectorReport, dateLocale, etc.): mostly `queryKey missing in UseQueryOptions`, plus `Locale` not found and `.terminal`/`.label` property mismatches.

**Why it matters:** There is a separate dedicated task to "make typecheck pass on master." Do NOT assume your change broke typecheck just because the root command exits non-zero — diff the error list against this baseline.

**How to validate your own code despite the broken reference:** copy the app tsconfig, drop the `references` array, and run `tsc -p` on the copy. `@workspace/*` imports still resolve through pnpm node_modules symlinks (references are only for build ordering), so you get a clean per-file check of just your code.

# Orval react-query typing pitfall

The generated `use*` query hooks type their options as `UseQueryOptions` which **requires `queryKey`**. Passing `{ query: { enabled: false } }` (to lazily fetch then `refetch()`) is a TS error in this repo's TS config — and existing code does it widely (that's part of the master breakage). To avoid adding new type debt, call the generated **plain async function** instead (e.g. `getQuickbooksConnectUrl()` rather than `useGetQuickbooksConnectUrl({ query: { enabled: false } })`) for on-demand, button-triggered fetches.

# Orval TS2308 with path+query param operations

An operation with BOTH a path param and query params makes Orval emit two same-named `<OpIdPascal>Params` exports (a zod object in `api-zod/generated/api.ts` and a query-params type in `generated/types/`), breaking the `export *` barrel with TS2308. Fix: add an explicit `export type { XParams } from "./generated/types";` line in `lib/api-zod/src/index.ts` (barrel is hand-maintained; orval only cleans `generated/`).
