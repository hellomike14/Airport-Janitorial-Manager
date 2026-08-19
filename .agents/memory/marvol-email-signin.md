---
name: Marvol email-only sign-in
description: The distinction between the portal's email-only sign-in UI and Clerk's tenant-level social-provider configuration.
---

The employee portal must present email authentication only. Social-login controls are hidden through Clerk's supported appearance configuration rather than by modifying Clerk's generated markup.

**Why:** The current workspace cannot manage the Replit-hosted Clerk tenant, so the Google provider cannot be deactivated here at the configuration level. Hiding the control preserves the intended portal flow without breaking the email form.

**How to apply:** If Clerk tenant management becomes available, turn Google off separately in each needed Clerk environment (Development and Production). Keep the app-level appearance override unless the user asks to restore social sign-in.