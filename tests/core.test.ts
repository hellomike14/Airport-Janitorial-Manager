import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseSupervisor,
  detectLocation,
  stripHtml,
} from "../src/core.js";

test("stripHtml returns readable plain text", () => {
  const result = stripHtml("<p>Spill at <strong>Gate B12</strong></p><p>Please clean now.</p>");
  assert.equal(result, "Spill at Gate B12\nPlease clean now.");
});

test("detectLocation extracts common airport locations", () => {
  const result = detectLocation(
    "Please clean the women's restroom near Gate B12 in Terminal 2.",
  );
  assert.ok(result);
  assert.match(result, /Gate B12/i);
  assert.match(result, /Terminal 2/i);
});

test("chooseSupervisor routes weekdays and weekends in the operations timezone", () => {
  const routing = {
    timezone: "America/New_York",
    weekdayName: "Priscilla",
    weekdayEmail: "priscilla@example.com",
    weekendName: "Ronaldo",
    weekendEmail: "ronaldo@example.com",
  };

  const friday = chooseSupervisor(new Date("2026-08-28T16:00:00Z"), routing);
  const saturday = chooseSupervisor(new Date("2026-08-29T16:00:00Z"), routing);

  assert.equal(friday.name, "Priscilla");
  assert.equal(friday.schedule, "weekday");
  assert.equal(saturday.name, "Ronaldo");
  assert.equal(saturday.schedule, "weekend");
});
