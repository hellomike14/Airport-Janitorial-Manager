import assert from "node:assert/strict";
import test from "node:test";
import {
  alertRecipientRoles,
  canDeleteSharedPhoto,
  canViewStaffLocations,
  requestedStaffIdMatchesActor,
  type StaffActor,
} from "./staffAuthorization";

const admin: StaffActor = { id: 1, role: "admin" };
const supervisor: StaffActor = { id: 2, role: "supervisor" };
const inspector: StaffActor = { id: 3, role: "inspector" };
const staff: StaffActor = { id: 4, role: "staff" };

test("client staff ids cannot select a different authenticated actor", () => {
  assert.equal(requestedStaffIdMatchesActor(staff, staff.id), true);
  assert.equal(requestedStaffIdMatchesActor(staff, undefined), true);
  assert.equal(requestedStaffIdMatchesActor(staff, admin.id), false);
});

test("only admins can view the complete live-location list", () => {
  assert.equal(canViewStaffLocations(admin), true);
  assert.equal(canViewStaffLocations(supervisor), false);
  assert.equal(canViewStaffLocations(inspector), false);
  assert.equal(canViewStaffLocations(staff), false);
});

test("photo owners and managers can delete shared photos", () => {
  assert.equal(canDeleteSharedPhoto(admin, staff.id), true);
  assert.equal(canDeleteSharedPhoto(supervisor, staff.id), true);
  assert.equal(canDeleteSharedPhoto(inspector, inspector.id), true);
  assert.equal(canDeleteSharedPhoto(staff, staff.id), true);
  assert.equal(canDeleteSharedPhoto(inspector, staff.id), false);
  assert.equal(canDeleteSharedPhoto(staff, inspector.id), false);
});

test("alert audiences preserve role boundaries", () => {
  assert.deepEqual(alertRecipientRoles(inspector, "staff"), ["staff"]);
  assert.deepEqual(alertRecipientRoles(admin, "all"), ["admin", "supervisor", "staff"]);
  assert.deepEqual(alertRecipientRoles(supervisor, "staff"), ["admin", "supervisor"]);
  assert.deepEqual(alertRecipientRoles(staff, "all"), ["admin", "supervisor"]);
});
