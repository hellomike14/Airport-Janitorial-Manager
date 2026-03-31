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


const SEED_STAFF: { name: string; role: "admin" | "inspector" | "supervisor" | "staff"; phone?: string; email?: string }[] = [
  { name: "Marcell Sutherland", role: "admin", phone: "407-555-0001", email: "msutherland@marvolenterprises.com" },
  { name: "MCO Inspector", role: "inspector", phone: "407-555-0099", email: "raquel.santana@goaa.org" },
  { name: "Priscila Rosero", role: "supervisor", email: "Priscilarosero27@gmail.com" },
  { name: "Reynaldo Hernandez Suarez", role: "supervisor", email: "Cnuevo986@gmail.co" },

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
        password: null,
        active: true,
      }))
    );
    console.log(`Seeded: ${toInsert.length} staff members (${toInsert.map((s) => s.name).join(", ")})`);
  }

  const managersWithPasswords = existingStaff.filter(
    (s) => (s.role === "admin" || s.role === "inspector" || s.role === "supervisor") && s.password
  );
  for (const mgr of managersWithPasswords) {
    await db.update(staffTable).set({ password: null }).where(eq(staffTable.id, mgr.id));
    console.log(`Cleared password for ${mgr.name} (will set PIN on next login)`);
  }

  for (const existing of existingStaff) {
    let seedEntry = SEED_STAFF.find((s) => s.name === existing.name);
    if (!seedEntry && (existing.role === "admin" || existing.role === "inspector")) {
      seedEntry = SEED_STAFF.find((s) => s.role === existing.role);
    }
    if (seedEntry && seedEntry.name !== existing.name) {
      await db.update(staffTable).set({ name: seedEntry.name }).where(eq(staffTable.id, existing.id));
      console.log(`Renamed ${existing.name} → ${seedEntry.name}`);
    }
    if (seedEntry && seedEntry.role !== existing.role) {
      await db.update(staffTable).set({ role: seedEntry.role }).where(eq(staffTable.id, existing.id));
      console.log(`Updated role for ${existing.name}: ${existing.role} → ${seedEntry.role}`);
    }
    if (seedEntry && seedEntry.email && seedEntry.email !== existing.email) {
      await db.update(staffTable).set({ email: seedEntry.email }).where(eq(staffTable.id, existing.id));
      console.log(`Updated ${existing.name}: email`);
    }
  }

  const existingAreas = await db.select({ id: areasTable.id, name: areasTable.name, terminal: areasTable.terminal, sortOrder: areasTable.sortOrder }).from(areasTable);
  const areaKey = (name: string, terminal: string) => `${name}||${terminal}`;
  const existingAreaKeys = new Map(existingAreas.map((a) => [areaKey(a.name, a.terminal), a]));

  for (const area of existingAreas) {
    const seedArea = SEED_AREAS.find((a) => a.name === area.name && a.terminal === area.terminal);
    if (seedArea && seedArea.sortOrder !== area.sortOrder) {
      await db.update(areasTable).set({ sortOrder: seedArea.sortOrder }).where(eq(areasTable.id, area.id));
      console.log(`Updated area ${area.name} (${area.terminal}): sortOrder → ${seedArea.sortOrder}`);
    }
  }

  for (const area of existingAreas) {
    const matchByName = SEED_AREAS.find((a) => a.name === area.name);
    if (matchByName && matchByName.terminal !== area.terminal) {
      const newKey = areaKey(area.name, matchByName.terminal);
      if (!existingAreaKeys.has(newKey)) {
        await db.update(areasTable).set({ terminal: matchByName.terminal, sortOrder: matchByName.sortOrder }).where(eq(areasTable.id, area.id));
        existingAreaKeys.set(newKey, area);
        existingAreaKeys.delete(areaKey(area.name, area.terminal));
        console.log(`Updated area ${area.name}: terminal ${area.terminal} → ${matchByName.terminal}`);
      }
    }
  }

  const newAreas = SEED_AREAS.filter((a) => !existingAreaKeys.has(areaKey(a.name, a.terminal)));
  if (existingAreas.length === 0) {
    await db.insert(areasTable).values(SEED_AREAS);
    console.log(`Seeded: ${SEED_AREAS.length} areas`);
  } else if (newAreas.length > 0) {
    await db.insert(areasTable).values(newAreas);
    console.log(`Added areas: ${newAreas.map((a) => `${a.name} (${a.terminal})`).join(", ")}`);
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
