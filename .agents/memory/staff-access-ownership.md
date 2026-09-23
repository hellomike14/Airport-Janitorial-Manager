---
name: Staff access ownership
description: Boundary between initial seed defaults and administrator-managed staff access.
---

Seed entries without login identity data are initial defaults, not instructions to revoke existing access. Preserve administrator-managed eligibility on reconciliation; explicit opt-outs and inactive/former restrictions still disable access.

**Why:** Treating missing seed email as a recurring login-disable instruction undid administrator changes and blocked both sign-in and assignments.

**How to apply:** Keep initial insertion policy separate from reconciliation. Do not repair access by adding forced active/nonformer seed values. Existing live eligibility repairs require deliberate administrator action, not automatic startup reactivation.