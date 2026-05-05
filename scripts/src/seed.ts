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
      { name: "Terminal A — Level P1 East",  terminal: "Terminal A - East", location: "East",         sortOrder: 2 },
      { name: "Terminal A — Level P2 East",  terminal: "Terminal A - East", location: "East",         sortOrder: 3 },
      { name: "Terminal A — Level P3 East",  terminal: "Terminal A - East", location: "East",         sortOrder: 4 },
      { name: "Terminal A — Level P4 East",  terminal: "Terminal A - East", location: "East",         sortOrder: 5 },
      { name: "Terminal A — Level R1 East",  terminal: "Terminal A - East", location: "East",         sortOrder: 6 },
      { name: "Terminal A — Level R2 East",  terminal: "Terminal A - East", location: "East",         sortOrder: 7 },
      { name: "Level 4 - Row L-H",           terminal: "Terminal A - East", location: "East",         sortOrder: 8 },
      { name: "Terminal A — Level 3 Row H-P", terminal: "Terminal A - East", location: "East",        sortOrder: 9 },
      { name: "Terminal A — Level 2 Row H-P", terminal: "Terminal A - East", location: "East",        sortOrder: 10 },
      { name: "Terminal A — Level 1 Row H-P", terminal: "Terminal A - East", location: "East",        sortOrder: 11 },
      { name: "Terminal A — R2 Avis",        terminal: "Terminal A - East", location: "East",         sortOrder: 12 },
      { name: "R1 - Avis",                   terminal: "Terminal A - East", location: "East",         sortOrder: 13 },
      { name: "Terminal A — Taxis",          terminal: "Terminal A - East", location: "East",         sortOrder: 14 },
      { name: "Check Point",                 terminal: "Terminal A - East", location: "East",         sortOrder: 15 },
      { name: "Terminal A — Garden",         terminal: "Terminal A - East", location: "East",         sortOrder: 16 },
      { name: "Terminal A - West Garage",    terminal: "Terminal A - West", location: "West",         sortOrder: 17 },
      { name: "Terminal A — Level P1 West",  terminal: "Terminal A - West", location: "West",         sortOrder: 18 },
      { name: "Terminal A — Level P2 West",  terminal: "Terminal A - West", location: "West",         sortOrder: 19 },
      { name: "Terminal A — Level P3 West",  terminal: "Terminal A - West", location: "West",         sortOrder: 20 },
      { name: "Terminal A — Level P4 West",  terminal: "Terminal A - West", location: "West",         sortOrder: 21 },
      { name: "Terminal A — Level R1 West",  terminal: "Terminal A - West", location: "West",         sortOrder: 22 },
      { name: "Terminal A — Level R2 West",  terminal: "Terminal A - West", location: "West",         sortOrder: 23 },
      { name: "Terminal A — Level 4 Row C-G", terminal: "Terminal A - West", location: "West",        sortOrder: 24 },
      { name: "Terminal A — Level 3 Row A-G", terminal: "Terminal A - West", location: "West",        sortOrder: 25 },
      { name: "Terminal A — Level 2 Row A-G", terminal: "Terminal A - West", location: "West",        sortOrder: 26 },
      { name: "Terminal A — Level 1 Row D-G", terminal: "Terminal A - West", location: "West",        sortOrder: 27 },
      { name: "R2 - Enterprises",            terminal: "Terminal A - West", location: "West",         sortOrder: 28 },
      { name: "R1 - Hertz",                  terminal: "Terminal A - West", location: "West",         sortOrder: 29 },
      { name: "Terminal B - East Garage",    terminal: "Terminal B - East", location: "East",         sortOrder: 30 },
      { name: "Terminal B — Level P1 East",  terminal: "Terminal B - East", location: "East",         sortOrder: 31 },
      { name: "Terminal B — Level P2 East",  terminal: "Terminal B - East", location: "East",         sortOrder: 32 },
      { name: "Terminal B — Level P3 East",  terminal: "Terminal B - East", location: "East",         sortOrder: 33 },
      { name: "Terminal B — Level P4 East",  terminal: "Terminal B - East", location: "East",         sortOrder: 34 },
      { name: "Terminal B — Level R1 East",  terminal: "Terminal B - East", location: "East",         sortOrder: 35 },
      { name: "Terminal B — Level R2 East",  terminal: "Terminal B - East", location: "East",         sortOrder: 36 },
      { name: "Terminal B — Level 4 Row C-G", terminal: "Terminal B - East", location: "East",        sortOrder: 37 },
      { name: "Terminal B — Level 3 Row A-G", terminal: "Terminal B - East", location: "East",        sortOrder: 38 },
      { name: "Terminal B — Level 2 Row A-G", terminal: "Terminal B - East", location: "East",        sortOrder: 39 },
      { name: "Terminal B — Level 1 Row D-G", terminal: "Terminal B - East", location: "East",        sortOrder: 40 },
      { name: "Terminal B — R2 Avis",        terminal: "Terminal B - East", location: "East",         sortOrder: 41 },
      { name: "R1 - Hertz/Enterprise Return", terminal: "Terminal B - East", location: "East",        sortOrder: 42 },
      { name: "Terminal B - West Garage",    terminal: "Terminal B - West", location: "West",         sortOrder: 43 },
      { name: "Terminal B — Level P1 West",  terminal: "Terminal B - West", location: "West",         sortOrder: 44 },
      { name: "Terminal B — Level P2 West",  terminal: "Terminal B - West", location: "West",         sortOrder: 45 },
      { name: "Terminal B — Level P3 West",  terminal: "Terminal B - West", location: "West",         sortOrder: 46 },
      { name: "Terminal B — Level P4 West",  terminal: "Terminal B - West", location: "West",         sortOrder: 47 },
      { name: "Terminal B — Level R1 West",  terminal: "Terminal B - West", location: "West",         sortOrder: 48 },
      { name: "Terminal B — Level R2 West",  terminal: "Terminal B - West", location: "West",         sortOrder: 49 },
      { name: "Level 4 - Row H-M",           terminal: "Terminal B - West", location: "West",         sortOrder: 50 },
      { name: "Terminal B — Level 3 Row H-P", terminal: "Terminal B - West", location: "West",        sortOrder: 51 },
      { name: "Terminal B — Level 2 Row H-P", terminal: "Terminal B - West", location: "West",        sortOrder: 52 },
      { name: "Terminal B — Level 1 Row H-P", terminal: "Terminal B - West", location: "West",        sortOrder: 53 },
      { name: "R2 - Hertz",                  terminal: "Terminal B - West", location: "West",         sortOrder: 54 },
      { name: "R1 - Aloma/Enterprise Pick up", terminal: "Terminal B - West", location: "West",      sortOrder: 55 },
      { name: "Terminal B — Taxis",          terminal: "Terminal B - West", location: "West",         sortOrder: 56 },
      { name: "Terminal B — Garden",         terminal: "Terminal B - West", location: "West",         sortOrder: 57 },
      { name: "Terminal C - Levels 1, 3, 5", terminal: "Terminal C", location: "Levels 1, 3, 5", sortOrder: 58 },
      { name: "Terminal C - Levels 2, 4, 6", terminal: "Terminal C", location: "Levels 2, 4, 6", sortOrder: 59 },
      { name: "Level 6 - C6 C59-C69",                             terminal: "Terminal C", location: "Level 6", sortOrder: 60 },
      { name: "Level 5 - C5 C59-C69",                             terminal: "Terminal C", location: "Level 5", sortOrder: 61 },
      { name: "Level 5 - Pedestrian Crossing",                    terminal: "Terminal C", location: "Level 5", sortOrder: 62 },
      { name: "Level 4 - C4 C59-C69",                             terminal: "Terminal C", location: "Level 4", sortOrder: 63 },
      { name: "Level 4 - Driveway",                               terminal: "Terminal C", location: "Level 4", sortOrder: 64 },
      { name: "Level 3 - C3 C59-C69",                             terminal: "Terminal C", location: "Level 3", sortOrder: 65 },
      { name: "Level 3 - Driveway/Pedestrian Walkway to trains",  terminal: "Terminal C", location: "Level 3", sortOrder: 66 },
      { name: "Level 3 - Pedestrian Walkway",                     terminal: "Terminal C", location: "Level 3", sortOrder: 67 },
      { name: "Level 2 - C2 Avis",                                terminal: "Terminal C", location: "Level 2", sortOrder: 68 },
      { name: "Level 2 - Pick up/Return Hertz, Return Hertz Pick up", terminal: "Terminal C", location: "Level 2", sortOrder: 69 },
      { name: "Level 2 - Pedestrian Walkway",                     terminal: "Terminal C", location: "Level 2", sortOrder: 70 },
      { name: "Level 1 - C1 Enterprise Return",                   terminal: "Terminal C", location: "Level 1", sortOrder: 71 },
      { name: "Level 1 - Sixt Return/Pick up",                    terminal: "Terminal C", location: "Level 1", sortOrder: 72 },
      { name: "Level 1 - Pedestrian Walkway",                     terminal: "Terminal C", location: "Level 1", sortOrder: 73 },
      { name: "Top Terminal - Levels 4-11",  terminal: "Top Terminal", location: "Levels 4-11", sortOrder: 74 },
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
