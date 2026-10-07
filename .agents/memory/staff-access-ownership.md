---
name: Staff access ownership
description: Boundary between initial seed defaults and administrator-managed staff access.
---

Do not identify a seeded owner or inspector from their role alone. A second HR administrator is a separate person, even when their permissions match the owner.

**Why:** Browser verification with a new HR account exposed a startup rule that tried to overwrite its email with the seeded owner's email.

**How to apply:** Match seed identities by their named record or matching normalized email, not by the first seed with the same role; preserve independently added administrators and inspectors.

Seed entries without login identity data are initial defaults, not instructions to revoke existing access. Preserve administrator-managed eligibility on reconciliation; explicit opt-outs and inactive/former restrictions still disable access.

**Why:** Treating missing seed email as a recurring login-disable instruction undid administrator changes and blocked both sign-in and assignments.

**How to apply:** Keep initial insertion policy separate from reconciliation. Do not repair access by adding forced active/nonformer seed values. Existing live eligibility repairs require deliberate administrator action, not automatic startup reactivation.