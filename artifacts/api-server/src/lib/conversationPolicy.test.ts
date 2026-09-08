import assert from "node:assert/strict";
import test from "node:test";
import { canStart, isAllowedPair, isInspectorManager } from "./conversationPolicy";

for (const role of ["admin", "supervisor"]) {
  test(`${role} can start, send, and receive inspector messages`, () => {
    const manager = { role }, inspector = { role: "inspector" };
    assert.equal(canStart(manager, inspector), true);
    assert.equal(canStart(inspector, manager), true);
    assert.equal(isAllowedPair(manager, inspector), true);
    assert.equal(isAllowedPair(inspector, manager), true);
    assert.equal(isInspectorManager(role), true);
  });
}
test("workers cannot acquire inspector email permissions", () => {
  assert.equal(canStart({ role: "staff" }, { role: "inspector" }), false);
  assert.equal(isAllowedPair({ role: "staff" }, { role: "inspector" }), false);
  assert.equal(isInspectorManager("staff"), false);
  assert.equal(isInspectorManager("inspector"), false);
});
