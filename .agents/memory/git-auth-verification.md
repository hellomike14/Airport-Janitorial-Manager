---
name: Git connection verification
description: Verification boundaries when an accepted Git provider connection does not authenticate workspace commands.
---

Do not treat an accepted Git provider connection as proof that a workspace push succeeded.

**Why:** A source-control connection was accepted while both ordinary and clean-URL Git pushes still rejected authentication, and the GitHub CLI had no authenticated session. The generic integration reauthorization lookup returned "Connection not found" for that accepted Git-provider connection.

**How to apply:** Verify the actual push result before claiming remote main is updated. Distinguish a generic inventory lookup failure from proof of expired OAuth. Keep the committed reconciliation intact, stop after bounded independent attempts, and do not request credentials in chat.

Repository-level `push`/`admin` flags do not prove the connected GitHub App has Contents write permission.

**Why:** Authenticated repository reads reported those flags while Git commit creation returned “Resource not accessible by integration.”

**How to apply:** Treat the actual write response as authoritative and use the integration recovery flow. Do not infer a successful merge from a successful read, and do not replace a safe fast-forward with a force push.
