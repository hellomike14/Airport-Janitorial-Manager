---
name: Admin confidential lock scope
description: Approved scope of the additional Admin access-code lock and safe verification boundaries.
---

The additional shared facility access code covers HR forms and document photos, staff personal information, and financial information including QuickBooks. It supplements verified Clerk sign-in and Admin authorization; it never grants access to nonAdmins. Preserve ordinary cleaning, staff operational selectors, onboarding and training access.

**Why:** The user selected all three confidential scopes while keeping the existing Admin-only HR rule.

**How to apply:** Protect direct API and original-file access as well as the UI. Do not ask for the code in chat or configure a default. Lost-code recovery requires authorized workspace-owner intervention, not a login-only reset.

Keep service verification isolated from the real shared setting. Use synthetic staff and a separate settings identity for code setup/change tests; do not overwrite a user-configured credential or leave a test code configured for the facility.

**Why:** Shared code changes revoke other administrators' grants and affect facility-wide access.

**How to apply:** Distinguish real server authorization checks from mocked browser unlock scenarios, and distinguish development verification from published authentication.
