---
name: Group reassignment scope
description: Why one-day roster moves do not rewrite task history or weekly schedules.
---

# One-day group moves

A dated group reassignment changes only the roster for the selected date. Keep existing task records and weekly schedules intact unless the user explicitly chooses a separate workflow to change those.

**Why:** Tasks can contain completed work and independently assigned inspector requests, while weekly schedules govern dates beyond the selected day. Inferring changes to either from a one-day move could rewrite history or unexpectedly affect future shifts.

**How to apply:** State the limited scope in the supervisor confirmation and keep recurring schedule changes deliberate and separate.

Creating a dated individual or group area assignment must also stay separate from recurring shifts. Payroll uses actual clocked, approved time, not the number of area assignments.

**Why:** One employee can cover several areas in a single shift. Turning those area assignments into recurring shifts duplicates scheduled coverage and can misrepresent payroll hours.

**How to apply:** Keep dated assignment creation idempotent without generating weekly schedule rows; preserve explicit reviewed weekly moves as their own workflow.

When explicitly transferring a recurring group schedule, treat the transfer as effective immediately, not as beginning on the date currently selected for a one-day roster.

**Why:** The weekly schedule model has no effective date; implying a chosen start date would promise behavior the stored schedule cannot express.

**How to apply:** Show that upcoming shifts, including this week's, change when the weekly move is confirmed. A future start date requires a separate effective-dated scheduling model.