---
name: Identity document privacy
description: Admin-only HR form and photograph access and the distinction between image review and employment verification.
---

Completed HR records and identity photographs are only accessible by Admin through the confidential access boundary. Staff, supervisors and inspectors must not view completed records or manage stored identity photographs, including through direct API or storage requests. Blank templates and the in-app completion editor are available to every signed-in role and public applicants; submitters may attach optional ID photos to their own application, but cannot retrieve submitted records. Identity photographs remain separate from operational photos, shared galleries and chat attachments. Never infer the employee link from a name.

**Why:** The user explicitly opened blank forms and applicant editing while keeping submitted copies and stored photo review restricted to Admin.

**How to apply:** Keep the blank-template/editor boundary separate from submitted records. Gate record list, detail, file-download, and photo-management routes by verified Admin plus the confidential access code. Do not reuse broader operational photo permissions. Leave onboarding/training access unchanged.

All photograph categories are optional and employee-selected. Uploaded, Needs clearer photo, and Reviewed describe receipt/legibility only; none establishes I-9 examination, employment authorization, or E-Verify completion.

**Why:** The user required this distinction; photographing or checking legibility is not employer document examination.

**How to apply:** Do not connect photograph status automatically to eligibility decisions or onboarding verification completion. Original submitted versions and upload/review history must remain intact when replacing images.
