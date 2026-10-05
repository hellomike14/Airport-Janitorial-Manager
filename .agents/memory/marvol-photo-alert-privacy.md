---
name: Marvol photo alert privacy
description: Privacy boundary for photo previews in task and issue alerts versus chat notifications.
---

Bell alerts about tasks and issues may show their existing before/after photos only when the recipient can also retrieve the underlying object. General new-message alerts must not show private chat attachments to nonparticipants.

**Why:** General chat alerts can be delivered to staff beyond a conversation's participants. Exposing an image path or preview in those alerts would reveal conversation content even if the chat itself is protected. Separately, a visible thumbnail that storage refuses to serve is a broken promise to legitimate task or issue alert recipients.

**How to apply:** When adding a photo-bearing alert, align recipient selection, notification response authorization, and storage-object read access. Keep conversation attachments limited to members of the exact conversation, including for broad staff broadcasts.