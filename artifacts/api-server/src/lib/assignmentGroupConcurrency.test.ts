import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { db, pool } from "@workspace/db";
import { groupAssignmentLock, planGroupReassignment } from "./assignmentGroups";

test("all assignment writers share a date/group lock and an intervening edit invalidates confirmation", async () => {
  // Check that each HTTP writer participates, not just the group endpoints.
  const routes = readFileSync(new URL("../routes/assignments.ts", import.meta.url), "utf8");
  assert.equal((routes.match(/tx\.execute\(groupAssignmentLock\(/g) ?? []).length, 4);

  const date = "2099-12-31";
  const group = "terminal-c-135";
  let releaseEdit!: () => void;
  const editHeld = new Promise<void>((resolve) => { releaseEdit = resolve; });
  let editLocked!: () => void;
  const locked = new Promise<void>((resolve) => { editLocked = resolve; });
  const rows = [{ id: 1, areaId: 1, staffId: 10, active: true }];
  const expected = [{ id: 1, staffId: 10 }];
  const edit = db.transaction(async (tx) => {
    await tx.execute(groupAssignmentLock(date, group));
    editLocked();
    await editHeld;
    rows.push({ id: 2, areaId: 2, staffId: 10, active: true });
  });
  try {
    await locked;
    let reassignmentLocked = false;
    const reassignment = db.transaction(async (tx) => {
      await tx.execute(groupAssignmentLock(date, group));
      reassignmentLocked = true;
      return planGroupReassignment([1, 2], rows, expected, 11);
    });
    // An independent transaction cannot acquire the lock before the edit commits.
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(reassignmentLocked, false);
    releaseEdit();
    assert.equal(await reassignment, null);
    await edit;
  } finally {
    releaseEdit();
    await edit;
    await pool.end();
  }
});