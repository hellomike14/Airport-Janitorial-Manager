import { expect, test } from "vitest";
import { finalTrainingPosition, shouldReportTrainingPause } from "./trainingPlayback";

test("a pause immediately before ended can safely report the terminal position", () => {
  expect(shouldReportTrainingPause({
    currentTime: 190.122993,
    ended: false,
    seeking: false,
  })).toBe(true);
  expect(shouldReportTrainingPause({
    currentTime: 178.629985,
    ended: false,
    seeking: false,
  })).toBe(true);
  expect(shouldReportTrainingPause({
    currentTime: 190.122993,
    ended: true,
    seeking: false,
  })).toBe(false);
});

test("uses a finite media end position and safely falls back to current time", () => {
  expect(finalTrainingPosition(190, 190.122993)).toBe(190.122993);
  expect(finalTrainingPosition(17, Number.NaN)).toBe(17);
  expect(finalTrainingPosition(Number.NaN, Number.NaN)).toBeNull();
});
