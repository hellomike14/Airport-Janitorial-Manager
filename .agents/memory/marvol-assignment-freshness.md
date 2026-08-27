---
name: Marvol assignment freshness
description: Why the staff task page must treat exact area assignments as authoritative and refresh them across sessions.
---

# Staff assignment visibility

Treat each shift assignment as an exact area assignment. Do not expand it to every area in the same terminal, and do not discard it merely because the area was archived after the assignment was created.

**Why:** Supervisors assign shifts in a separate session from the staff member viewing My Tasks. A cached empty assignment response or terminal-wide expansion can make the staff member see no assignment or many unrelated areas.

**How to apply:** Wait until the authenticated staff identity is resolved, query assignments for that staff ID and local work date, and refetch whenever My Tasks mounts. Use the assignment response itself as the authority for assigned area IDs and labels.