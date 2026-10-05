---
name: Managed workflow port collisions
description: A managed artifact restart may leave a stale server on the assigned port.
---

If a managed Vite workflow reports that its assigned port is occupied, do not accept a fallback port as a successful preview. Confirm the actual listener and the browser-facing proxy target before treating the app as verified. Prefer strict-port behavior so a new instance fails visibly instead of reporting healthy while the proxy serves an older instance.

**Why:** A managed restart left an earlier Vite process listening on the proxy's port while the new process reported RUNNING on a fallback port. A 200 response from the proxy alone did not prove it was the new app.

**How to apply:** On port-in-use startup warnings, identify the stale listener, distinguish it from the current managed process, and restore the workflow to its assigned port before relying on screenshots or health checks.