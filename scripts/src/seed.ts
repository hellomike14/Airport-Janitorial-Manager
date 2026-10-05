import { db } from "@workspace/db";
import { areasTable, staffTable } from "@workspace/db/schema";
import { MCO_TERMINAL_AREAS } from "@workspace/db/area-catalog";

async function seed() {
  console.log("Seeding database...");

  const existingStaff = await db.select().from(staffTable);
  if (existingStaff.length === 0) {
    await db.insert(staffTable).values([
      {
        name: "Maria Rodriguez",
        role: "supervisor",
        phone: "407-555-0101",
        email: "m.rodriguez@marvolfacility.com",
        active: true,
      },
      {
        name: "James Thompson",
        role: "supervisor",
        phone: "407-555-0102",
        email: "j.thompson@marvolfacility.com",
        active: true,
      },
      {
        name: "Carlos Rivera",
        role: "staff",
        phone: "407-555-0201",
        email: "c.rivera@marvolfacility.com",
        active: true,
      },
      {
        name: "Tanisha Williams",
        role: "staff",
        phone: "407-555-0202",
        email: "t.williams@marvolfacility.com",
        active: true,
      },
      {
        name: "Miguel Santos",
        role: "staff",
        phone: "407-555-0203",
        email: "m.santos@marvolfacility.com",
        active: true,
      },
      {
        name: "Lisa Chen",
        role: "staff",
        phone: "407-555-0204",
        email: "l.chen@marvolfacility.com",
        active: true,
      },
      {
        name: "Robert Johnson",
        role: "staff",
        phone: "407-555-0205",
        email: "r.johnson@marvolfacility.com",
        active: true,
      },
      {
        name: "Aisha Davis",
        role: "staff",
        phone: "407-555-0206",
        email: "a.davis@marvolfacility.com",
        active: true,
      },
      {
        name: "Emmanuel Okonkwo",
        role: "staff",
        phone: "407-555-0207",
        email: "e.okonkwo@marvolfacility.com",
        active: true,
      },
      {
        name: "Sofia Martinez",
        role: "staff",
        phone: "407-555-0208",
        email: "s.martinez@marvolfacility.com",
        active: true,
      },
      {
        name: "Derek Wilson",
        role: "staff",
        phone: "407-555-0209",
        email: "d.wilson@marvolfacility.com",
        active: true,
      },
      {
        name: "Priya Patel",
        role: "staff",
        phone: "407-555-0210",
        email: "p.patel@marvolfacility.com",
        active: true,
      },
    ]);
    console.log("Staff seeded.");
  } else {
    console.log("Staff already exists, skipping.");
  }

  const existingAreas = await db.select().from(areasTable);
  if (existingAreas.length === 0) {
    await db
      .insert(areasTable)
      .values(
        MCO_TERMINAL_AREAS.map(
          ({ legacyNames: _legacyNames, ...area }) => area,
        ),
      );
    console.log(`Seeded ${MCO_TERMINAL_AREAS.length} MCO cleaning areas.`);
  } else {
    console.log(
      "Areas already exist; startup reconciliation will preserve and update them.",
    );
  }

  console.log("Seeding complete!");
  process.exit(0);
}

seed().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
