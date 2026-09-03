import assert from "node:assert/strict";
import test from "node:test";
import { filterConversationsByArchiveState } from "./conversationArchive";

test("archive filtering is scoped to the requesting participant", () => {
  const conversations = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const aliceArchived = new Set([2]);
  const bobArchived = new Set([1, 3]);

  assert.deepEqual(
    filterConversationsByArchiveState(conversations, aliceArchived, false),
    [{ id: 1 }, { id: 3 }],
  );
  assert.deepEqual(
    filterConversationsByArchiveState(conversations, aliceArchived, true),
    [{ id: 2 }],
  );
  assert.deepEqual(
    filterConversationsByArchiveState(conversations, bobArchived, false),
    [{ id: 2 }],
  );
});

test("filtering never mutates or removes conversation records", () => {
  const conversations = [{ id: 1 }, { id: 2 }];
  const original = [...conversations];
  filterConversationsByArchiveState(conversations, new Set([1]), false);
  assert.deepEqual(conversations, original);
});
