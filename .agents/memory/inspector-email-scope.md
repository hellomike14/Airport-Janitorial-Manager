---
name: Inspector email scope
description: User-confirmed external inspector messaging behavior and its safety boundary.
---

The shared inspector conversation is a single app identity. Management chooses exactly one external inspector or all approved inspectors for each new app message; the app should never silently choose the broadcast option. Approved inspectors must be able to initiate new emails to the shared sender address, as well as reply to app-originated mail. Keep incoming authentication and sender checks intact for both paths.

**Why:** The user explicitly chose recipient selection and then confirmed that new inbound email—not merely replies—is required. Direct mail should not be treated as an implicit group broadcast or as an unauthenticated conversation.

**How to apply:** Preserve the shared thread and explicit recipient decision when changing messaging flows; distinguish new direct mail from tokenized replies. Do not assume the outside mailbox or SendGrid routing is configured just because the app accepts these messages.