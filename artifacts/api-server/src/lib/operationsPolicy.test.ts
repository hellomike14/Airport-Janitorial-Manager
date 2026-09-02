import assert from "node:assert/strict";
import test from "node:test";
import {
  canStaffWorkTaskByScope,
  missingRoutineTaskDefinitions,
  validateScheduleTimeUpdate,
} from "./operationsPolicy";

test("an explicit task assignee takes precedence over area membership", () => {
  assert.equal(canStaffWorkTaskByScope(10, 10, false), true);
  assert.equal(canStaffWorkTaskByScope(10, 11, true), false);
  assert.equal(canStaffWorkTaskByScope(10, null, true), true);
  assert.equal(canStaffWorkTaskByScope(10, null, false), false);
});

test("special requests do not suppress missing routine checklist rows", () => {
  const definitions = [
    { taskName: "Sweep", taskOrder: 1 },
    { taskName: "Mop", taskOrder: 2 },
    { taskName: "Mop", taskOrder: 3 },
  ];
  const existing = [
    { taskName: "Inspector request", isSpecial: true },
    { taskName: "Sweep", isSpecial: false },
  ];

  assert.deepEqual(missingRoutineTaskDefinitions(definitions, existing), [
    { taskName: "Mop", taskOrder: 2 },
  ]);
});

test("partial schedule edits validate against the stored opposite time", () => {
  const current = { startTime: "08:00", endTime: "16:00" };

  assert.deepEqual(validateScheduleTimeUpdate(current, {}, false), {
    ok: false,
    reason: "no_updates",
  });
  assert.deepEqual(
    validateScheduleTimeUpdate(current, { startTime: "18:00" }, true),
    { ok: false, reason: "invalid_time_order" },
  );
  assert.deepEqual(
    validateScheduleTimeUpdate(current, { endTime: "07:00" }, true),
    { ok: false, reason: "invalid_time_order" },
  );
  assert.deepEqual(
    validateScheduleTimeUpdate(current, { startTime: "09:00" }, true),
    { ok: true, startTime: "09:00", endTime: "16:00" },
  );
});
