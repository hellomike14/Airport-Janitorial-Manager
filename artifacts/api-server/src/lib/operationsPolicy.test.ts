import assert from "node:assert/strict";
import test from "node:test";
import { compactChecklist } from "./compactChecklist";
import {
  csvCell,
  distanceMeters,
  gpsProblem,
  inspectionScore,
  isCurrentEmployee,
  monthRange,
  orlandoDate,
  overlaps,
  paidMinutes,
  previousMonth,
  validDate,
} from "./operationsPolicy";

test("Airport badge visibility excludes inspectors and requires current employee flags", () => {
  assert.equal(isCurrentEmployee({ active: true, formerEmployee: false, role: "staff" }), true);
  assert.equal(isCurrentEmployee({ active: true, formerEmployee: false, role: "supervisor" }), true);
  assert.equal(isCurrentEmployee({ active: true, formerEmployee: false, role: "admin" }), true);
  assert.equal(isCurrentEmployee({ active: true, formerEmployee: false, role: "inspector" }), false);
  assert.equal(isCurrentEmployee({ active: true, formerEmployee: false, role: "unknown" }), false);
  assert.equal(isCurrentEmployee({ active: false, formerEmployee: false, role: "staff" }), false);
  assert.equal(isCurrentEmployee({ active: true, formerEmployee: true, role: "staff" }), false);
  assert.equal(isCurrentEmployee({ active: true, role: "staff" }), false);
  assert.equal(isCurrentEmployee({ active: true, formerEmployee: false }), false);
});

test("Orlando work dates respect midnight and DST independently of host timezone", () => {
  assert.equal(orlandoDate(new Date("2026-10-05T02:00:00Z")), "2026-10-04");
  assert.equal(orlandoDate(new Date("2026-01-01T04:30:00Z")), "2025-12-31");
  assert.equal(previousMonth(new Date("2026-01-01T06:00:00Z")), "2025-12");
  assert.deepEqual(monthRange("2024-02"), {
    from: "2024-02-01",
    to: "2024-03-01",
  });
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2024-02-29"), true);
});
test("GPS checks reject inaccurate and off-site points", () => {
  const settings = {
    gpsRequired: true,
    siteLatitude: 28.4312,
    siteLongitude: -81.3081,
    radiusMeters: 5000,
    maxAccuracyMeters: 200,
  };
  assert.equal(distanceMeters(28.4312, -81.3081, 28.4312, -81.3081), 0);
  assert.equal(
    gpsProblem(
      { latitude: 28.4312, longitude: -81.3081, accuracy: 20 },
      settings,
    ),
    null,
  );
  assert.match(
    gpsProblem(
      { latitude: 28.4312, longitude: -81.3081, accuracy: 500 },
      settings,
    )!,
    /accuracy/,
  );
  assert.match(
    gpsProblem({ latitude: 0, longitude: 0, accuracy: 1 }, settings)!,
    /worksite/,
  );
});
test("paid hours span midnight without multiplying area assignments", () => {
  assert.equal(
    paidMinutes({
      clockIn: new Date("2026-10-05T22:00:00Z"),
      clockOut: new Date("2026-10-06T06:00:00Z"),
      breakMinutes: 30,
    }),
    450,
  );
  assert.equal(
    paidMinutes({ clockIn: new Date(), clockOut: null, breakMinutes: 0 }),
    0,
  );
  assert.equal(
    overlaps(
      { startTime: "14:00", endTime: "22:00" },
      { startTime: "21:00", endTime: "23:00" },
    ),
    true,
  );
  assert.equal(
    overlaps(
      { startTime: "14:00", endTime: "22:00" },
      { startTime: "22:00", endTime: "23:00" },
    ),
    false,
  );
});
test("inspection threshold uses all 15 points and CSV neutralizes formulas", () => {
  assert.equal(inspectionScore([...Array(14).fill(true), false]), 93);
  assert.equal(inspectionScore([...Array(13).fill(true), false, false]), 87);
  assert.throws(() => inspectionScore([true]));
  assert.equal(csvCell('=HYPERLINK("example")'), '"\'=HYPERLINK(""example"")"');
  assert.equal(csvCell("Doe, Jane"), '"Doe, Jane"');
});
test("oversized sheets compact to six groups without dropping bin identities or rounds", () => {
  const source = [
    "Sweep floors",
    "Empty trash receptacles",
    "Clean stairs and handrails",
    "Clean elevator buttons",
    "Spot clean glass",
    "Inspect drains and hazards",
    ...Array.from(
      { length: 90 },
      (_, i) => `${i % 2 ? "After" : "Before"} Lunch — Line 1 Bin #${i + 1}`,
    ),
  ].map((taskName, i) => ({ taskName, taskOrder: i }));
  const compact = compactChecklist(source);
  assert.equal(compact.length, 6);
  assert.equal(compact.filter((t) => t.photoRequired).length, 3);
  const duties = compact.map((t) => t.notes).join("\n");
  for (const task of source)
    assert.ok(duties.includes(task.taskName), task.taskName);
  const single = compactChecklist([
    { taskName: "Clean garden trash bin", taskOrder: 1 },
  ]);
  assert.equal(single.length, 1);
  assert.equal(single[0].photoRequired, true);
});
