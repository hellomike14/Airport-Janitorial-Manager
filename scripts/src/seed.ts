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
      { name: "Terminal A - East Garage",    terminal: "Terminal A - East", location: "East",         sortOrder: 1 },
      { name: "Level P1 - East",             terminal: "Terminal A - East", location: "East",         sortOrder: 2 },
      { name: "Level P2 - East",             terminal: "Terminal A - East", location: "East",         sortOrder: 3 },
      { name: "Level P3 - East",             terminal: "Terminal A - East", location: "East",         sortOrder: 4 },
      { name: "Level P4 - East",             terminal: "Terminal A - East", location: "East",         sortOrder: 5 },
      { name: "Level R1 - East",             terminal: "Terminal A - East", location: "East",         sortOrder: 6 },
      { name: "Level R2 - East",             terminal: "Terminal A - East", location: "East",         sortOrder: 7 },
      { name: "Terminal A - West Garage",    terminal: "Terminal A - West", location: "West",         sortOrder: 8 },
      { name: "Level P1 - West",             terminal: "Terminal A - West", location: "West",         sortOrder: 9 },
      { name: "Level P2 - West",             terminal: "Terminal A - West", location: "West",         sortOrder: 10 },
      { name: "Level P3 - West",             terminal: "Terminal A - West", location: "West",         sortOrder: 11 },
      { name: "Level P4 - West",             terminal: "Terminal A - West", location: "West",         sortOrder: 12 },
      { name: "Level R1 - West",             terminal: "Terminal A - West", location: "West",         sortOrder: 13 },
      { name: "Level R2 - West",             terminal: "Terminal A - West", location: "West",         sortOrder: 14 },
      { name: "Terminal B - East Garage",    terminal: "Terminal B - East", location: "East",         sortOrder: 15 },
      { name: "Level P1 - East",             terminal: "Terminal B - East", location: "East",         sortOrder: 16 },
      { name: "Level P2 - East",             terminal: "Terminal B - East", location: "East",         sortOrder: 17 },
      { name: "Level P3 - East",             terminal: "Terminal B - East", location: "East",         sortOrder: 18 },
      { name: "Level P4 - East",             terminal: "Terminal B - East", location: "East",         sortOrder: 19 },
      { name: "Level R1 - East",             terminal: "Terminal B - East", location: "East",         sortOrder: 20 },
      { name: "Level R2 - East",             terminal: "Terminal B - East", location: "East",         sortOrder: 21 },
      { name: "Terminal B - West Garage",    terminal: "Terminal B - West", location: "West",         sortOrder: 22 },
      { name: "Level P1 - West",             terminal: "Terminal B - West", location: "West",         sortOrder: 23 },
      { name: "Level P2 - West",             terminal: "Terminal B - West", location: "West",         sortOrder: 24 },
      { name: "Level P3 - West",             terminal: "Terminal B - West", location: "West",         sortOrder: 25 },
      { name: "Level P4 - West",             terminal: "Terminal B - West", location: "West",         sortOrder: 26 },
      { name: "Level R1 - West",             terminal: "Terminal B - West", location: "West",         sortOrder: 27 },
      { name: "Level R2 - West",             terminal: "Terminal B - West", location: "West",         sortOrder: 28 },
      { name: "Terminal C - Levels 1, 3, 5", terminal: "Terminal C", location: "Levels 1, 3, 5", sortOrder: 29 },
      { name: "Terminal C - Levels 2, 4, 6", terminal: "Terminal C", location: "Levels 2, 4, 6", sortOrder: 30 },
      { name: "Top Terminal - Levels 4-11",  terminal: "Top Terminal", location: "Levels 4-11", sortOrder: 31 },
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
