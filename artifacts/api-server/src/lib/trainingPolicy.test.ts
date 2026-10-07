import test from "node:test";
import assert from "node:assert/strict";
import { earliestUncreditedPosition, fullyWatched, heartbeatPosition, mergeWatchRanges, normalizedSignature, watchInterval, watchedSeconds, watchCreditClock } from "./trainingPolicy";

test("seeking to the end or sending a fabricated advance earns no watch coverage", () => {
  const previous = { lastPosition: 0, wasPlaying: true, updatedAt: new Date(0) };
  assert.equal(watchInterval(previous, { position: 190, seeking: true, rate: 1 }, new Date(5000)), null);
  assert.equal(watchInterval(previous, { position: 190, seeking: false, rate: 1 }, new Date(5000)), null);
  assert.equal(watchInterval({ ...previous, wasPlaying: false }, { position: 5, seeking: false, rate: 1 }, new Date(5000)), null);
  assert.deepEqual(watchInterval(previous, { position: 5, seeking: false, rate: 1 }, new Date(5000)), [0, 5]);
});
test("replayed segments do not double count and skipped middle segments do not qualify", () => {
  const ranges = mergeWatchRanges([[0, 20], [5, 15], [20, 40], [90, 100]], 100);
  assert.equal(watchedSeconds(ranges), 50);
  assert.equal(fullyWatched(ranges, 100), false);
  assert.equal(fullyWatched(mergeWatchRanges([...ranges, [40, 90]], 100), 100), true);
});
test("browser rounding is tolerated only at the start/end, not substantial internal gaps", () => {
  assert.equal(fullyWatched([[0.1, 99.9]], 100), true);
  assert.equal(fullyWatched([[2, 100]], 100), false);
  assert.equal(fullyWatched([[0, 90]], 100), false);
});
test("recovery starts just before the earliest uncredited segment without changing earned ranges", () => {
  const ranges: [number, number][] = [[0, 10], [20, 40], [50, 178.629985]];
  const before = structuredClone(ranges);
  assert.equal(earliestUncreditedPosition(ranges, 190.122993), 9.75);
  assert.deepEqual(ranges, before);
  assert.equal(earliestUncreditedPosition([[0, 178.629985]], 190.122993), 178.379985);
  assert.equal(earliestUncreditedPosition([[0.1, 190]], 190.122993), 0);
});
test("delayed non-seeking heartbeats cannot move the active watch position backward", () => {
  assert.equal(heartbeatPosition(12, 9, false), 12);
  assert.equal(heartbeatPosition(12, 9, true), 9);
  assert.equal(heartbeatPosition(12, 15, false), 15);
});
test("signature normalization preserves identity without sensitivity to case and spaces", () => {
  assert.equal(normalizedSignature("  Maria  García "), normalizedSignature("maria garcía"));
  assert.notEqual(normalizedSignature("Maria García"), normalizedSignature("Another Person"));
});

test("rapid requests cannot accumulate timing tolerance, including after pauses", () => {
  let previous = { lastPosition: 0, wasPlaying: true, updatedAt: new Date(0) };
  let credited = 0;
  for (let i = 1; i <= 500; i++) {
    const current = { position: i * 0.5, seeking: false, rate: 2 };
    const interval = watchInterval(previous, current, new Date(0));
    credited += interval ? interval[1] - interval[0] : 0;
    previous = { lastPosition: current.position, wasPlaying: true,
      updatedAt: watchCreditClock(previous.updatedAt, interval, 2, new Date(0)) };
    assert.equal(watchCreditClock(previous.updatedAt, null, 2, new Date(0)).getTime(), previous.updatedAt.getTime());
  }
  assert.ok(credited <= 0.75);
});

test("continuous playback with network jitter repays borrowed tolerance", () => {
  let previous = { lastPosition: 0, wasPlaying: true, updatedAt: new Date(0) };
  const ranges: [number, number][] = [];
  for (let i = 1; i <= 20; i++) {
    const now = new Date(i * 5000 + (i % 2 ? -100 : 100));
    const current = { position: i * 10, seeking: false, rate: 2 };
    const interval = watchInterval(previous, current, now);
    assert.ok(interval);
    ranges.push(interval);
    previous = { lastPosition: current.position, wasPlaying: true,
      updatedAt: watchCreditClock(previous.updatedAt, interval, 2, now) };
  }
  assert.equal(fullyWatched(mergeWatchRanges(ranges, 200), 200), true);
});

test("a serialized end report can credit the final segment after the last heartbeat", () => {
  const duration = 190.122993;
  const lastHeartbeat = 178.629985;
  const elapsedMs = (duration - lastHeartbeat) * 1000;
  const interval = watchInterval(
    { lastPosition: lastHeartbeat, wasPlaying: true, updatedAt: new Date(0) },
    { position: duration, seeking: false, rate: 1 },
    new Date(elapsedMs),
  );
  assert.deepEqual(interval, [lastHeartbeat, duration]);
  assert.equal(fullyWatched(mergeWatchRanges([[0, lastHeartbeat], interval!], duration), duration), true);
});
