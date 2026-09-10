---
name: Sign-in latency diagnosis
description: Browser-confirmed Clerk bootstrap timeout and limits of the evidence from the login fallback.
---

Treat the green sign-in connection-error screen as a generic bootstrap failure, not evidence of Wi-Fi trouble or staff rejection.

**Why:** A read-only production browser experiment on 2026-09-10 delayed the initial Clerk script by 22 seconds, then allowed it to succeed. The exact reported screen appeared, Clerk logged `failed_to_load_clerk_js`, and the form did not recover during roughly 65 seconds of observation. An undelayed fresh context loaded in about 2.4 seconds. This confirms a latency-triggered failure mechanism, not the cause of the original user's delay.

**How to apply:** When improving recovery, explicitly test delayed-but-successful script loading and recovery after SDK rejection. Do not clear storage containing unsynced work or weaken staff eligibility. Roster eligibility and mocked role tests do not establish successful real production logins.