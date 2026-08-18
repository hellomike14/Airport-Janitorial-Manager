---
name: Marvol artifact routing
description: How the marvol monorepo routes web + API paths on the shared proxy
---
The shared workspace proxy — not a Vite proxy — routes requests: the web app previews at the domain root and the API server owns the /api prefix.

**Why:** curling an API endpoint under the web app's directory-name path silently returns the SPA's index.html (Vite history fallback) instead of API JSON, which looks like a broken backend.

**How to apply:** when testing the API in dev, hit /api/... at the domain root; check the artifact routing config for path ownership before assuming a proxy misconfiguration.
