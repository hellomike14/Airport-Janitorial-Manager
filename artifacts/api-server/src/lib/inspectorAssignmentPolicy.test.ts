import assert from "node:assert/strict";
import test from "node:test";
import { inspectorAssignmentDueAt, matchInspectorMessageArea, selectAssignedStaff } from "./inspectorAssignmentPolicy";

test("location matching refuses ambiguous shared names", () => {
  assert.deepEqual(matchInspectorMessageArea("Location: Garden", [{ id: 1, name: "Garden", terminal: "Terminal A" }, { id: 2, name: "Garden", terminal: "Terminal B" }]), { status: "ambiguous" });
  assert.deepEqual(matchInspectorMessageArea("Location: Terminal A Garden", [{ id: 1, name: "Garden", terminal: "Terminal A" }, { id: 2, name: "Garden", terminal: "Terminal B" }]), { status: "matched", areaId: 1 });
});
test("fresh GPS wins; workload and ids deterministically break ties", () => {
  const now = new Date("2026-09-03T12:00:00Z");
  const selected = selectAssignedStaff([{ staffId: 8, incompleteSpecialTaskCount: 0, latestLocation: { latitude: 1, longitude: 1, accuracy: 10, updatedAt: now } }, { staffId: 2, incompleteSpecialTaskCount: 4, latestLocation: { latitude: 1.01, longitude: 1.01, accuracy: 10, updatedAt: now } }], { latitude: 1, longitude: 1 }, now);
  assert.equal(selected?.staffId, 8);
  assert.deepEqual(selectAssignedStaff([{ staffId: 8, incompleteSpecialTaskCount: 1 }, { staffId: 2, incompleteSpecialTaskCount: 1 }], null, now), { staffId: 2, method: "area_roster_workload", distanceMeters: null });
});
test("inspector SLA is exactly fifteen minutes", () => assert.equal(inspectorAssignmentDueAt(new Date(0)).getTime(), 900000));