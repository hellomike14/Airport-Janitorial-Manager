---
name: Schedule group locking
description: Why schedule writers serialize across terminal groups during reviewed moves.
---

# Schedule group locking

Ordinary schedule writers lock every terminal group in a fixed order before reading or changing schedule rows; reviewed moves lock only their own group.

**Why:** An edit can move a row between groups, bulk inserts can span groups, and deletes may not know their affected groups until reading rows. Locking a group based only on a preliminary unlocked read can race with a concurrent area change. The broader locking trades schedule-write concurrency for predictable reviewed moves and deadlock-free ordering.

**How to apply:** Any new path that inserts, changes, or deletes weekly schedules must participate in the same transaction-scoped locking protocol before touching schedule rows. If write contention becomes material, refine the protocol with a consistent way to lock both source and destination groups without introducing lock-order inversions.