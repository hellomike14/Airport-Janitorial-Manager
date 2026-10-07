---
name: Temporary document tooling
description: Keep one-off Python asset-processing setup from changing the TypeScript application's project configuration.
---

Check workspace changes after installing Python tooling for document inspection. Keep unrelated Python scaffolding and unnecessary native dependency changes out of this TypeScript application's source.

**Why:** Installing a PDF inspection package unexpectedly created a root Python project and added native packages to workspace configuration, although the application itself did not need Python.

**How to apply:** Clean up only inspection-generated scaffolding and outputs after processing, preserve uploaded source files, and use the validated configuration replacement flow for workspace configuration cleanup.
