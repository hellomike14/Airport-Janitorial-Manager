import test from "node:test";
import assert from "node:assert/strict";
import { parseVideoRange } from "./videoRange";

test("video range supports complete, bounded, open-ended and suffix requests", () => {
  assert.equal(parseVideoRange(undefined, 100), null);
  assert.deepEqual(parseVideoRange("bytes=0-9", 100), { start: 0, end: 9 });
  assert.deepEqual(parseVideoRange("bytes=75-", 100), { start: 75, end: 99 });
  assert.deepEqual(parseVideoRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseVideoRange("bytes=-200", 100), { start: 0, end: 99 });
  assert.deepEqual(parseVideoRange("bytes=0-200", 100), { start: 0, end: 99 });
});

test("video range rejects malformed, multiple and unsatisfiable requests", () => {
  for (const range of ["bytes=-", "bytes=-0", "bytes=100-", "bytes=9-2",
    "bytes=0-2,4-6", "items=0-2", "bytes=1.5-8", "bytes=9007199254740992-"]) {
    assert.equal(parseVideoRange(range, 100), false, range);
  }
  assert.equal(parseVideoRange("bytes=0-", 0), false);
});
