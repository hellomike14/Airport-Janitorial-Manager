---
name: Online employment forms
description: Scope, privacy boundaries, and PDF.js compatibility lessons for employment form completion.
---

Employment forms must be editable inside the app, not merely marked fillable or opened in a separate PDF reader. Preserve the blank templates; saved and printed copies must contain the entered text and selections on all pages.

**Why:** The user corrected the label-and-download approach and explicitly requested online completion plus administrator printing and saving.

**How to apply:** Keep the in-app editor and device PDF export/print working. Completed standalone forms may be stored and emailed only with an explicit access boundary and recipient. Preserve submitted snapshots for Admin review; do not invent a retention period or automatically delete them until the user sets one.

Do not infer that a PDF has no fillable fields from empty document-level field-object metadata.

**Why:** All three supplied templates returned empty field-object metadata in PDF.js while their page annotations contained editable widgets; saving and reopening widget edits succeeded.

**How to apply:** Inspect page widget annotations and verify a saved PDF round trip. Match the PDF.js library and worker versions, and consult installed types before reusing options or cleanup APIs from older major versions.

Verify the visible form and the exported field values separately; neither DOM state nor a correct saved PDF proves that the editor shows the user's current entries.

**Why:** W-4 rendering first displayed unchecked statuses as checked, then hid actual edited text/selections while its saved and printed PDFs remained correct. This could mislead someone completing a tax form.

**How to apply:** Check blank and edited text/checkbox appearances after blur or zoom as well as saved PDF values. Do not enable embedded PDF scripting merely to make editable controls visible.
