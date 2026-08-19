---
name: Marvol orval codegen safety
description: Rules for keeping hand-written client helpers safe across orval regeneration runs.
---

Custom client functions must never be appended to orval-generated files (`generated/api.ts`, `generated/api.schemas.ts`). Orval's `clean: true` setting deletes the entire `generated/` directory on every run, silently erasing any hand-written code.

**Rule:** put custom fetch helpers in a stable sibling file (e.g. `lib/api-client-react/src/messaging-extras.ts`) and re-export it from `lib/api-client-react/src/index.ts`. Consumers import from `@workspace/api-client-react` as usual and get both generated and custom symbols.

**Why:** the group-conversation and per-message delete/edit helpers were lost during a codegen run triggered by an unrelated schema change, causing a runtime breakage visible only at build time.

**How to apply:** whenever adding a new non-spec client helper, create or extend `lib/api-client-react/src/<feature>-extras.ts` and add it to `index.ts`. If the helper can be expressed in the OpenAPI spec, add it there instead so codegen covers it automatically.
