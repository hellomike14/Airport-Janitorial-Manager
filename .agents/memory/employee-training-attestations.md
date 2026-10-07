---
name: Employee training attestations
description: Business requirements and verification boundaries for Marvol employee training.
---

Keep separate, initially unchecked “I watched the full training video” and “I understand the training” confirmations, plus the signed-in employee’s typed full-name signature. Describe completion as an employee attestation, never proof of comprehension.

**Why:** The user explicitly required these statements and this distinction. Playback tracking cannot establish a person's attention or understanding.

**How to apply:** Preserve both confirmations and identity binding when changing the training flow. A replacement video requires a fresh version-specific acknowledgment while retaining previous records and manager per-employee review. Seeking alone must not qualify an employee to sign.

Use synthetic identities for positive browser tests that save attestations; never create a comprehension statement for an actual employee during automated verification.

**Why:** An automated test cannot truthfully attest on an operational employee’s behalf.

**How to apply:** Clean up only test-owned fixtures; verify persistence against an isolated database when a synthetic authenticated account is unavailable.

Do not assume every browser can decode an MP4 merely because it contains H.264/AAC. Keep a private WebM delivery fallback for the same canonical training content.

**Why:** The authenticated media endpoint returned valid MP4 byte ranges, but the verification browser reported no supported streams and no MP4 codec support.

**How to apply:** Verify actual decoding and playback, not just HTTP success. Keep compatibility encodings tied to the same approved content version and never overwrite their stored files.

Training belongs under Employment → Onboarding, not Employee Portal. Every active, login-enabled staff role, including inspectors, needs access to its own training there, without access to another employee's records, other hires, applications, or QuickBooks.

**Why:** The user explicitly changed the destination and required existing Employment/Onboarding access controls and saved records to remain intact.

**How to apply:** Keep training identity-bound to the server-resolved staff account rather than hire checklist rows. Former, inactive, and login-disabled records remain blocked. Manager completion review stays admin/supervisor-only; moving the UI must never reset progress, signatures, timestamps, or version history.

Exclude all former employees from the New Employee Training review list while retaining their saved training records.

**Why:** The user instructed: "Marvolfacility: remove all former employeesfrom New Employee Training."

**How to apply:** Apply the former-employee exclusion to the server review list and cached UI results. Do not delete historical attestations or infer that every inactive employee is a former employee.
