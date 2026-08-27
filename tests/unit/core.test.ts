import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseSupervisor,
  detectLocation,
  stripHtml,
} from "../../src/core.js";

test("stripHtml returns readable plain text", () => {
  const result = stripHtml("<p>Spill at <strong>Gate B12</strong></p><p>Please clean now.</p>");
  assert.equal(result, "Spill at Gate B12\nPlease clean now.");
});

test("detectLocation extracts airport gate and terminal references", () => {
  const result = detectLocation("Clean the restroom near Gate B12 in Terminal 2.");
  assert.ok(result);
  assert.match(result, /Gate B12/i);
  assert.match(result, /Terminal 2/i);
});

test("supervisor routing separates weekdays and weekends", () => {
  const routing = {
    timezone: "America/New_York",
    weekdayName: "Priscilla",
    weekdayEmail: "priscilla@example.com",
    weekendName: "Ronaldo",
    weekendEmail: "ronaldo@example.com",
  };

  assert.equal(
    chooseSupervisor(new Date("2026-08-28T16:00:00Z"), routing).name,
    "Priscilla",
  );
  assert.equal(
    chooseSupervisor(new Date("2026-08-29T16:00:00Z"), routing).name,
    "Ronaldo",
  );
});
