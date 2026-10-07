---
name: Identity document privacy
description: Admin-only HR form and photograph access and the distinction between image review and employment verification.
---

All HR forms and photos are only accessible by Admin. Staff, supervisors and inspectors must not view, upload, download, review or manage HR forms or identity photographs, including through direct API or storage requests. Identity photographs remain separate from operational photos, shared galleries and chat attachments. Never infer the employee link from a name.

**Why:** The user clarified: "Marvolfacility: All HR forms and photos are only accessible by Admin."

**How to apply:** Gate the Forms UI and every HR document endpoint by the verified Admin role. Do not reuse broader operational photo permissions or allow employee self-access. Leave onboarding/training access unchanged.

All photograph categories are optional and employee-selected. Uploaded, Needs clearer photo, and Reviewed describe receipt/legibility only; none establishes I-9 examination, employment authorization, or E-Verify completion.

**Why:** The user required this distinction; photographing or checking legibility is not employer document examination.

**How to apply:** Do not connect photograph status automatically to eligibility decisions or onboarding verification completion. Original submitted versions and upload/review history must remain intact when replacing images.
