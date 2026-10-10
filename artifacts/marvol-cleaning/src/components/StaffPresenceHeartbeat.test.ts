import assert from "node:assert/strict";
import test from "node:test";
import { isPresenceHeartbeatDue, PRESENCE_HEARTBEAT_MS, PRESENCE_IDLE_MS } from "./StaffPresenceHeartbeat";

test("presence client sends only while signed in, visible, recently interacted, and outside the cadence window", () => {
  const base = { loggedIn: true, visible: true, lastInteractionAt: 100_000, lastHeartbeatAt: 70_000, now: 100_000 };
  assert.equal(isPresenceHeartbeatDue(base), true);
  assert.equal(isPresenceHeartbeatDue({ ...base, loggedIn: false }), false);
  assert.equal(isPresenceHeartbeatDue({ ...base, visible: false }), false);
  assert.equal(isPresenceHeartbeatDue({ ...base, lastHeartbeatAt: 99_999 }), false);
  assert.equal(isPresenceHeartbeatDue({ ...base, now: 100_001 + PRESENCE_IDLE_MS }), false);
  assert.equal(PRESENCE_HEARTBEAT_MS, 30_000);
});
