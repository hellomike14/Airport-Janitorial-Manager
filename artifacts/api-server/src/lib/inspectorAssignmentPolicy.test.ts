import assert from "node:assert/strict";
import test from "node:test";
import {
  extractInspectorRequestedDate,
  extractInspectorTargetCoordinates,
  inspectorAssignmentDueAt,
  inspectorAssignmentNeedsEscalation,
  matchInspectorMessageArea,
  selectAssignedStaff,
} from "./inspectorAssignmentPolicy";

const areas = [
  { id: 1, name: "Level 4 - Row C-G", terminal: "Terminal A - West" },
  { id: 2, name: "Level 4 - Row C-G", terminal: "Terminal B - East" },
  { id: 3, name: "R2 - Avis", terminal: "Terminal A - East" },
];

test("matches an explicit, fully qualified configured area", () => {
  assert.deepEqual(
    matchInspectorMessageArea(
      "Urgent spill\nLocation: Terminal B - East / Level 4 - Row C-G",
      areas,
    ),
    { status: "matched", areaId: 2, matchedBy: "explicit_label" },
  );
  assert.deepEqual(
    matchInspectorMessageArea(
      "Location: Terminal B - East / Level 4 - Row C-G near the elevator",
      areas,
    ),
    { status: "matched", areaId: 2, matchedBy: "explicit_label" },
  );
});

test("does not guess when a configured area name is ambiguous", () => {
  assert.deepEqual(matchInspectorMessageArea("Area: Level 4 - Row C-G", areas), {
    status: "ambiguous",
    areaIds: [1, 2],
  });
});

test("leaves a missing or unknown location for supervisor triage", () => {
  assert.deepEqual(matchInspectorMessageArea("Trash needs attention near arrivals", areas), {
    status: "missing",
  });
  assert.deepEqual(matchInspectorMessageArea("Location: baggage claim", areas), {
    status: "missing",
  });
});

test("extracts only valid explicit dates and coordinates", () => {
  const body = "Date: 2026-09-03\nCoordinates: 28.4312, -81.3081";
  assert.equal(extractInspectorRequestedDate(body), "2026-09-03");
  assert.deepEqual(extractInspectorTargetCoordinates(body), {
    latitude: 28.4312,
    longitude: -81.3081,
  });
  assert.equal(extractInspectorRequestedDate("Date: 2026-02-30"), null);
  assert.equal(extractInspectorTargetCoordinates("GPS: 200, -81"), null);
});

test("uses fresh GPS only when target coordinates are supplied", () => {
  const now = new Date("2026-09-02T16:00:00Z");
  const candidates = [
    {
      staffId: 10,
      incompleteSpecialTaskCount: 0,
      latestLocation: {
        latitude: 28.5,
        longitude: -81.4,
        updatedAt: new Date("2026-09-02T15:50:00Z"),
      },
    },
    {
      staffId: 11,
      incompleteSpecialTaskCount: 5,
      latestLocation: {
        latitude: 28.4313,
        longitude: -81.3082,
        updatedAt: new Date("2026-09-02T15:55:00Z"),
      },
    },
  ];
  assert.equal(
    selectAssignedStaff(candidates, { latitude: 28.4312, longitude: -81.3081 }, now)?.staffId,
    11,
  );
  assert.deepEqual(selectAssignedStaff(candidates, null, now), {
    staffId: 10,
    method: "area_roster_workload",
    distanceMeters: null,
  });
});

test("falls back to workload when GPS is stale and breaks ties by id", () => {
  const now = new Date("2026-09-02T16:00:00Z");
  const selected = selectAssignedStaff(
    [
      {
        staffId: 5,
        incompleteSpecialTaskCount: 1,
        latestLocation: {
          latitude: 28.4,
          longitude: -81.3,
          updatedAt: new Date("2026-09-02T14:00:00Z"),
        },
      },
      { staffId: 4, incompleteSpecialTaskCount: 1 },
    ],
    { latitude: 28.4, longitude: -81.3 },
    now,
  );
  assert.deepEqual(selected, {
    staffId: 4,
    method: "area_roster_workload",
    distanceMeters: null,
  });
});

test("sets a 15-minute due time and escalation is idempotent", () => {
  const createdAt = new Date("2026-09-02T16:00:00Z");
  const dueAt = inspectorAssignmentDueAt(createdAt);
  assert.equal(dueAt.toISOString(), "2026-09-02T16:15:00.000Z");
  assert.equal(
    inspectorAssignmentNeedsEscalation({
      completed: false,
      dueAt,
      escalatedAt: null,
      now: new Date("2026-09-02T16:15:00Z"),
    }),
    true,
  );
  assert.equal(
    inspectorAssignmentNeedsEscalation({
      completed: false,
      dueAt,
      escalatedAt: new Date("2026-09-02T16:15:01Z"),
      now: new Date("2026-09-02T16:30:00Z"),
    }),
    false,
  );
});

test("escalation selection excludes the originally assigned staff member", () => {
  assert.deepEqual(
    selectAssignedStaff(
      [
        { staffId: 1, incompleteSpecialTaskCount: 0 },
        { staffId: 2, incompleteSpecialTaskCount: 1 },
      ],
      null,
      new Date("2026-09-02T16:30:00Z"),
      undefined,
      new Set([1]),
    ),
    { staffId: 2, method: "area_roster_workload", distanceMeters: null },
  );
});
