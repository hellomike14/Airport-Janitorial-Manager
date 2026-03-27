import app from "./app";
import { db } from "@workspace/db";
import { staffTable, areasTable, taskTypesTable } from "@workspace/db/schema";
import { eq, count, inArray } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const SEED_AREAS = [
  { name: "Terminal A - East Garage",    terminal: "Terminal A", location: "East",         sortOrder: 1 },
  { name: "Terminal A - West Garage",    terminal: "Terminal A", location: "West",         sortOrder: 2 },
  { name: "Terminal B - East Garage",    terminal: "Terminal B", location: "East",         sortOrder: 3 },
  { name: "Terminal B - West Garage",    terminal: "Terminal B", location: "West",         sortOrder: 4 },
  { name: "Terminal C - Levels 1, 3, 5", terminal: "Terminal C", location: "Levels 1, 3, 5", sortOrder: 5 },
  { name: "Terminal C - Levels 2, 4, 6", terminal: "Terminal C", location: "Levels 2, 4, 6", sortOrder: 6 },
  { name: "Top Terminal - Levels 4-11",  terminal: "Top Terminal", location: "Levels 4-11", sortOrder: 7 },
];

const SEED_TASK_TYPES = [
  { taskName: "Routine sweep of all levels — remove debris, trash, and litter", taskOrder: 1 },
  { taskName: "Mop and sanitize all floor surfaces — extra attention to high-traffic zones", taskOrder: 2 },
  { taskName: "Deep clean stairwells — scrub landings, steps, and corners", taskOrder: 3 },
  { taskName: "Clean and sanitize elevator cabs — floors, walls, buttons, and tracks", taskOrder: 4 },
  { taskName: "Sanitize all handrails, elevator buttons, and high-touch surfaces", taskOrder: 5 },
  { taskName: "Empty all trash receptacles and replace liners", taskOrder: 6 },
  { taskName: "Spot clean walls, pillars, signs, and partitions", taskOrder: 7 },
  { taskName: "Remove gum, stains, and debris from floor surfaces", taskOrder: 8 },
  { taskName: "Clean entry/exit areas, doors, and glass partitions", taskOrder: 9 },
  { taskName: "Inspect and clean drainage grates and floor drains", taskOrder: 10 },
  { taskName: "Inspect and report any maintenance issues or safety hazards", taskOrder: 11 },
  { taskName: "Final supervisor inspection walk-through and sign-off", taskOrder: 12 },
  { taskName: "Clean/remove cigarette butts in terminal", taskOrder: 13 },
];

const SEED_STAFF: { name: string; role: "admin" | "inspector" | "supervisor" | "staff"; phone?: string; email?: string; password?: string }[] = [
  { name: "System Administrator", role: "admin", phone: "407-555-0001", email: "admin@marvolfacility.com", password: "$2b$10$hTe4/CeWiDj8SQAgvvkkNuSbxGjs.0eIvRgXsYiPNZTFa9mNaRv8y" },
  { name: "MCO Inspector", role: "inspector", phone: "407-555-0099", email: "raquel.santana@goaa.org", password: "$2b$10$MGwP2M8DkjmpZ5lcv9ycZutXOjLsUlki9JKSXTkIEMZco7WojVUVm" },
  { name: "Priscila Rosero", role: "supervisor", password: "$2b$10$4PEq..9JdOLPP4bRJlXys.mZbwWQLuQy6aYMGq5DBfCJoUX4m487e" },
  { name: "Reynaldo Hernandez Suarez", role: "supervisor", password: "$2b$10$4PEq..9JdOLPP4bRJlXys.mZbwWQLuQy6aYMGq5DBfCJoUX4m487e" },
  { name: "Ashandre Longmore", role: "staff" },
  { name: "Edner Jules", role: "staff" },
  { name: "Ivan Serrano", role: "staff" },
  { name: "Jason Delgado", role: "staff" },
  { name: "Jean Gardy Rigueur", role: "staff" },
  { name: "Jose Camargo", role: "staff" },
  { name: "Juan Carlos Zurita Blacio", role: "staff" },
  { name: "Kevin Gonzalez Fernandez", role: "staff" },
  { name: "Marie Ingrid Daniel", role: "staff" },
  { name: "Steeve Alphonse", role: "staff" },
];

async function seed() {
  const seedNames = new Set(SEED_STAFF.map((s) => s.name));
  const existingStaff = await db.select().from(staffTable);
  const existingNames = new Set(existingStaff.map((s) => s.name));

  const toInsert = SEED_STAFF.filter((s) => !existingNames.has(s.name));
  if (toInsert.length > 0) {
    await db.insert(staffTable).values(
      toInsert.map((s) => ({
        name: s.name,
        role: s.role,
        phone: s.phone ?? null,
        email: s.email ?? null,
        password: s.password ?? null,
        active: true,
      }))
    );
    console.log(`Seeded: ${toInsert.length} staff members (${toInsert.map((s) => s.name).join(", ")})`);
  }

  for (const existing of existingStaff) {
    const seedEntry = SEED_STAFF.find((s) => s.name === existing.name);
    if (seedEntry && seedEntry.role !== existing.role) {
      await db.update(staffTable).set({ role: seedEntry.role }).where(eq(staffTable.id, existing.id));
      console.log(`Updated role for ${existing.name}: ${existing.role} → ${seedEntry.role}`);
    }
    if (seedEntry && seedEntry.email) {
      const updates: Record<string, string> = {};
      if (seedEntry.email !== existing.email) {
        updates.email = seedEntry.email;
      }
      if (seedEntry.role === "inspector" && seedEntry.password) {
        updates.password = seedEntry.password;
      } else if (seedEntry.password && !existing.password) {
        updates.password = seedEntry.password;
      }
      if (Object.keys(updates).length > 0) {
        await db.update(staffTable).set(updates).where(eq(staffTable.id, existing.id));
        console.log(`Updated ${existing.name}: ${Object.keys(updates).join(", ")}`);
      }
    } else if (seedEntry && seedEntry.password && !existing.password) {
      await db.update(staffTable).set({ password: seedEntry.password }).where(eq(staffTable.id, existing.id));
      console.log(`Set password for ${existing.name}`);
    }
  }

  const [{ value: areaCount }] = await db.select({ value: count() }).from(areasTable);
  if (areaCount === 0) {
    await db.insert(areasTable).values(SEED_AREAS);
    console.log(`Seeded: ${SEED_AREAS.length} areas`);
  }

  const [{ value: ttCount }] = await db.select({ value: count() }).from(taskTypesTable);
  if (ttCount === 0) {
    await db.insert(taskTypesTable).values(
      SEED_TASK_TYPES.map((t) => ({ taskName: t.taskName, taskOrder: t.taskOrder, active: true }))
    );
    console.log(`Seeded: ${SEED_TASK_TYPES.length} task types`);
  }
}

app.listen(port, async () => {
  console.log(`Server listening on port ${port}`);
  await seed().catch((err) => console.error("Seed error:", err));
});
