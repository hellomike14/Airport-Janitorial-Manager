import assert from "node:assert/strict";
import test from "node:test";
import { MCO_TERMINAL_AREAS } from "@workspace/db/area-catalog";
import { areaBelongsToGroup, planGroupAssignment, TERMINAL_GROUP_KEYS } from "./assignmentGroups";

test("each catalog cleaning area belongs to exactly one of the seven terminal groups", () => {
  const counts = Object.fromEntries(TERMINAL_GROUP_KEYS.map((key) => [key, 0]));
  for (const area of MCO_TERMINAL_AREAS) {
    const matched = TERMINAL_GROUP_KEYS.filter((key) => areaBelongsToGroup(area, key));
    assert.equal(matched.length, 1, `${area.terminal} / ${area.name} must belong to one group`);
    counts[matched[0]]++;
  }
  assert.deepEqual(counts, {
    "terminal-a-east": 9,
    "terminal-a-west": 6,
    "terminal-b-east": 6,
    "terminal-b-west": 8,
    "terminal-c-135": 3,
    "terminal-c-246": 3,
    "top-terminal": 8,
  });
});

test("older Terminal C level names stay in their correct groups", () => {
  const odd = { terminal: "Terminal C", name: "Level 3 - Pedestrian Walkway", location: "Level 3" };
  const even = { terminal: "Terminal C", name: "Level 4 - Driveway", location: "Level 4" };
  assert.equal(areaBelongsToGroup(odd, "terminal-c-135"), true);
  assert.equal(areaBelongsToGroup(odd, "terminal-c-246"), false);
  assert.equal(areaBelongsToGroup(even, "terminal-c-135"), false);
  assert.equal(areaBelongsToGroup(even, "terminal-c-246"), true);
});

test("one staff member per group: refuse conflicts and do not duplicate existing areas", () => {
  assert.equal(planGroupAssignment([1, 2, 3], [
    { areaId: 1, staffId: 10 }, { areaId: 2, staffId: 11 },
  ], 10), null);
  assert.deepEqual(planGroupAssignment([1, 2, 3], [
    { areaId: 1, staffId: 10 }, { areaId: 1, staffId: 10 },
  ], 10), { missingIds: [2, 3], existingCount: 1 });
});