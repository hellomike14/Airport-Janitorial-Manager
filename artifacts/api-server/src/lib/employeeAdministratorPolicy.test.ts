import assert from "node:assert/strict";
import test from "node:test";
import {
  employeeAdministratorCanCreateRole,
  employeeAdministratorCanUpdateTarget,
} from "./employeeAdministratorPolicy";

test("employee administrators can create ordinary staff but cannot grant roles", () => {
  assert.equal(employeeAdministratorCanCreateRole("staff"), true);
  for (const role of ["supervisor", "admin", "inspector", "employee_administrator"]) {
    assert.equal(employeeAdministratorCanCreateRole(role), false, role);
  }
});

test("employee administrators can update ordinary active identities without changing roles", () => {
  const ordinary = { id: 27, role: "staff", formerEmployee: false };
  assert.equal(employeeAdministratorCanUpdateTarget(18, ordinary, undefined), true);
  assert.equal(employeeAdministratorCanUpdateTarget(27, ordinary, undefined), false, "cannot edit own privileges");
  assert.equal(employeeAdministratorCanUpdateTarget(18, ordinary, "supervisor"), false);
  assert.equal(employeeAdministratorCanUpdateTarget(18, ordinary, "admin"), false);
  assert.equal(employeeAdministratorCanUpdateTarget(18, ordinary, "employee_administrator"), false);
  for (const role of ["admin", "supervisor", "inspector", "employee_administrator"]) {
    assert.equal(employeeAdministratorCanUpdateTarget(18, { ...ordinary, role }, undefined), false, role);
  }
  assert.equal(employeeAdministratorCanUpdateTarget(18, { ...ordinary, formerEmployee: true }, undefined), false);
});
