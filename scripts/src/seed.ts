import { db } from "@workspace/db";
import { staffTable, areasTable } from "@workspace/db/schema";

async function seed() {
  console.log("Seeding database...");

  // Seed staff (10 staff + 2 supervisors)
  const existingStaff = await db.select().from(staffTable);
  if (existingStaff.length === 0) {
    await db.insert(staffTable).values([
      { name: "Maria Rodriguez", role: "supervisor", phone: "407-555-0101", email: "m.rodriguez@marvolfacility.com", active: true },
      { name: "James Thompson", role: "supervisor", phone: "407-555-0102", email: "j.thompson@marvolfacility.com", active: true },
      { name: "Carlos Rivera", role: "staff", phone: "407-555-0201", email: "c.rivera@marvolfacility.com", active: true },
      { name: "Tanisha Williams", role: "staff", phone: "407-555-0202", email: "t.williams@marvolfacility.com", active: true },
      { name: "Miguel Santos", role: "staff", phone: "407-555-0203", email: "m.santos@marvolfacility.com", active: true },
      { name: "Lisa Chen", role: "staff", phone: "407-555-0204", email: "l.chen@marvolfacility.com", active: true },
      { name: "Robert Johnson", role: "staff", phone: "407-555-0205", email: "r.johnson@marvolfacility.com", active: true },
      { name: "Aisha Davis", role: "staff", phone: "407-555-0206", email: "a.davis@marvolfacility.com", active: true },
      { name: "Emmanuel Okonkwo", role: "staff", phone: "407-555-0207", email: "e.okonkwo@marvolfacility.com", active: true },
      { name: "Sofia Martinez", role: "staff", phone: "407-555-0208", email: "s.martinez@marvolfacility.com", active: true },
      { name: "Derek Wilson", role: "staff", phone: "407-555-0209", email: "d.wilson@marvolfacility.com", active: true },
      { name: "Priya Patel", role: "staff", phone: "407-555-0210", email: "p.patel@marvolfacility.com", active: true },
    ]);
    console.log("Staff seeded.");
  } else {
    console.log("Staff already exists, skipping.");
  }

  // Seed areas
  const existingAreas = await db.select().from(areasTable);
  if (existingAreas.length === 0) {
    await db.insert(areasTable).values([
      { name: "Terminal A - East Garage", terminal: "Terminal A", location: "East", sortOrder: 1 },
      { name: "Terminal A - West Garage", terminal: "Terminal A", location: "West", sortOrder: 2 },
      { name: "Terminal B - East Garage", terminal: "Terminal B", location: "East", sortOrder: 3 },
      { name: "Terminal B - West Garage", terminal: "Terminal B", location: "West", sortOrder: 4 },
      { name: "Terminal C - Levels 1, 3, 5", terminal: "Terminal C", location: "Levels 1, 3, 5", sortOrder: 5 },
      { name: "Terminal C - Levels 2, 4, 6", terminal: "Terminal C", location: "Levels 2, 4, 6", sortOrder: 6 },
      { name: "Top Terminal - Levels 4-11", terminal: "Top Terminal", location: "Levels 4-11", sortOrder: 7 },
    ]);
    console.log("Areas seeded.");
  } else {
    console.log("Areas already exist, skipping.");
  }

  console.log("Seeding complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
