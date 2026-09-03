import assert from "node:assert/strict";
import test from "node:test";
import { REQUIRED_PRODUCTION_LOGIN_NAMES, SEED_STAFF } from "../seed-data";
import {
  isAppAccessDeniedEmail,
  normalizeLoginEmail,
  verifiedPrimaryEmail,
} from "./loginIdentity";

test("login emails are normalized without altering their local part", () => {
  assert.equal(normalizeLoginEmail("  User.Name+MCO@Example.COM "), "user.name+mco@example.com");
});

test("the notification-only address is denied regardless of casing or whitespace", () => {
  assert.equal(isAppAccessDeniedEmail(" MSutherland@MarvolEnterprises.com "), true);
  assert.equal(isAppAccessDeniedEmail("inspector@marvolenterprises.com"), false);
});

test("only a verified primary Clerk address can identify a staff member", () => {
  assert.equal(
    verifiedPrimaryEmail({
      primaryEmailAddressId: "primary",
      emailAddresses: [
        {
          id: "primary",
          emailAddress: " Inspector@MarvolEnterprises.com ",
          verification: { status: "verified" },
        },
        {
          id: "secondary",
          emailAddress: "someone-else@example.com",
          verification: { status: "verified" },
        },
      ],
    }),
    "inspector@marvolenterprises.com",
  );

  assert.equal(
    verifiedPrimaryEmail({
      primaryEmailAddressId: "primary",
      emailAddresses: [
        {
          id: "primary",
          emailAddress: "inspector@marvolenterprises.com",
          verification: { status: "unverified" },
        },
        {
          id: "secondary",
          emailAddress: "verified-but-not-primary@example.com",
          verification: { status: "verified" },
        },
      ],
    }),
    null,
  );

  assert.equal(
    verifiedPrimaryEmail({
      primaryEmailAddressId: null,
      emailAddresses: [
        {
          id: "secondary",
          emailAddress: "verified-but-not-primary@example.com",
          verification: { status: "verified" },
        },
      ],
    }),
    null,
  );
});

test("every seeded identity with an email is restored for production sign-in", () => {
  const emailFor = (name: string) => SEED_STAFF.find((staff) => staff.name === name)?.email;

  assert.equal(emailFor("MCO Inspector"), "inspector@marvolenterprises.com");
  assert.equal(emailFor("Reynaldo Hernandez Suarez"), "cnuevo986@gmail.com");
  assert.equal(emailFor("Kevin Gonzalez Fernandez"), "kevingonzalez2015830@gmail.com");
  assert.equal(emailFor("Ivan Serrano"), "ivanserrano737@gmail.com");
  const staffWithEmail = SEED_STAFF.filter((staff) => staff.email);
  const staffWithoutEmail = SEED_STAFF.filter((staff) => !staff.email);
  assert.deepEqual(
    [...REQUIRED_PRODUCTION_LOGIN_NAMES].sort(),
    staffWithEmail.map((staff) => staff.name).sort(),
  );
  assert.equal(
    staffWithoutEmail.some((staff) => REQUIRED_PRODUCTION_LOGIN_NAMES.has(staff.name)),
    false,
  );
  assert.equal(
    SEED_STAFF.some((staff) => staff.email === "msutherland@marvolenterprises.com"),
    false,
  );
});
