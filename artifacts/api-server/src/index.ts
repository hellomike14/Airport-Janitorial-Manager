import app from "./app";
import { db } from "@workspace/db";
import { staffTable, areasTable, taskTypesTable, notificationsTable, staffLocationsTable } from "@workspace/db/schema";
import { eq, and, count, inArray } from "drizzle-orm";
import { renameSharedAreaName, AREA_RENAME_MAP } from "./area-renames";

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

const RAW_SEED_AREAS = [
  { name: "Terminal A - East Garage",    terminal: "Terminal A - East", location: "East",         sortOrder: 1 },
  { name: "Level P1 - East",             terminal: "Terminal A - East", location: "East",         sortOrder: 2 },
  { name: "Level P2 - East",             terminal: "Terminal A - East", location: "East",         sortOrder: 3 },
  { name: "Level P3 - East",             terminal: "Terminal A - East", location: "East",         sortOrder: 4 },
  { name: "Level P4 - East",             terminal: "Terminal A - East", location: "East",         sortOrder: 5 },
  { name: "Level R1 - East",             terminal: "Terminal A - East", location: "East",         sortOrder: 6 },
  { name: "Level R2 - East",             terminal: "Terminal A - East", location: "East",         sortOrder: 7 },
  { name: "Level 4 - Row L-H",           terminal: "Terminal A - East", location: "East",         sortOrder: 8 },
  { name: "Level 3 - Row H-P",           terminal: "Terminal A - East", location: "East",         sortOrder: 9 },
  { name: "Level 2 - Row H-P",           terminal: "Terminal A - East", location: "East",         sortOrder: 10 },
  { name: "Level 1 - Row H-P",           terminal: "Terminal A - East", location: "East",         sortOrder: 11 },
  { name: "R2 - Avis",                   terminal: "Terminal A - East", location: "East",         sortOrder: 12 },
  { name: "R1 - Avis",                   terminal: "Terminal A - East", location: "East",         sortOrder: 13 },
  { name: "Taxis",                       terminal: "Terminal A - East", location: "East",         sortOrder: 14 },
  { name: "Check Point",                 terminal: "Terminal A - East", location: "East",         sortOrder: 15 },
  { name: "Garden",                      terminal: "Terminal A - East", location: "East",         sortOrder: 16 },
  { name: "Terminal A - West Garage",    terminal: "Terminal A - West", location: "West",         sortOrder: 17 },
  { name: "Level P1 - West",             terminal: "Terminal A - West", location: "West",         sortOrder: 18 },
  { name: "Level P2 - West",             terminal: "Terminal A - West", location: "West",         sortOrder: 19 },
  { name: "Level P3 - West",             terminal: "Terminal A - West", location: "West",         sortOrder: 20 },
  { name: "Level P4 - West",             terminal: "Terminal A - West", location: "West",         sortOrder: 21 },
  { name: "Level R1 - West",             terminal: "Terminal A - West", location: "West",         sortOrder: 22 },
  { name: "Level R2 - West",             terminal: "Terminal A - West", location: "West",         sortOrder: 23 },
  { name: "Level 4 - Row C-G",           terminal: "Terminal A - West", location: "West",         sortOrder: 24 },
  { name: "Level 3 - Row A-G",           terminal: "Terminal A - West", location: "West",         sortOrder: 25 },
  { name: "Level 2 - Row A-G",           terminal: "Terminal A - West", location: "West",         sortOrder: 26 },
  { name: "Level 1 - Row D-G",           terminal: "Terminal A - West", location: "West",         sortOrder: 27 },
  { name: "R2 - Enterprises",            terminal: "Terminal A - West", location: "West",         sortOrder: 28 },
  { name: "R1 - Hertz",                  terminal: "Terminal A - West", location: "West",         sortOrder: 29 },
  { name: "Terminal B - East Garage",    terminal: "Terminal B - East", location: "East",         sortOrder: 30 },
  { name: "Level P1 - East",             terminal: "Terminal B - East", location: "East",         sortOrder: 31 },
  { name: "Level P2 - East",             terminal: "Terminal B - East", location: "East",         sortOrder: 32 },
  { name: "Level P3 - East",             terminal: "Terminal B - East", location: "East",         sortOrder: 33 },
  { name: "Level P4 - East",             terminal: "Terminal B - East", location: "East",         sortOrder: 34 },
  { name: "Level R1 - East",             terminal: "Terminal B - East", location: "East",         sortOrder: 35 },
  { name: "Level R2 - East",             terminal: "Terminal B - East", location: "East",         sortOrder: 36 },
  { name: "Level 4 - Row C-G",                                terminal: "Terminal B - East", location: "East",         sortOrder: 37 },
  { name: "Level 3 - Row A-G",                                terminal: "Terminal B - East", location: "East",         sortOrder: 38 },
  { name: "Level 2 - Row A-G",                                terminal: "Terminal B - East", location: "East",         sortOrder: 39 },
  { name: "Level 1 - Row D-G",                                terminal: "Terminal B - East", location: "East",         sortOrder: 40 },
  { name: "R2 - Avis",                                        terminal: "Terminal B - East", location: "East",         sortOrder: 41 },
  { name: "R1 - Hertz/Enterprise Return",                     terminal: "Terminal B - East", location: "East",         sortOrder: 42 },
  { name: "Terminal B - West Garage",    terminal: "Terminal B - West", location: "West",         sortOrder: 43 },
  { name: "Level P1 - West",             terminal: "Terminal B - West", location: "West",         sortOrder: 44 },
  { name: "Level P2 - West",             terminal: "Terminal B - West", location: "West",         sortOrder: 45 },
  { name: "Level P3 - West",             terminal: "Terminal B - West", location: "West",         sortOrder: 46 },
  { name: "Level P4 - West",             terminal: "Terminal B - West", location: "West",         sortOrder: 47 },
  { name: "Level R1 - West",             terminal: "Terminal B - West", location: "West",         sortOrder: 48 },
  { name: "Level R2 - West",             terminal: "Terminal B - West", location: "West",         sortOrder: 49 },
  { name: "Level 4 - Row H-M",                                terminal: "Terminal B - West", location: "West",         sortOrder: 50 },
  { name: "Level 3 - Row H-P",                                terminal: "Terminal B - West", location: "West",         sortOrder: 51 },
  { name: "Level 2 - Row H-P",                                terminal: "Terminal B - West", location: "West",         sortOrder: 52 },
  { name: "Level 1 - Row H-P",                                terminal: "Terminal B - West", location: "West",         sortOrder: 53 },
  { name: "R2 - Hertz",                                       terminal: "Terminal B - West", location: "West",         sortOrder: 54 },
  { name: "R1 - Aloma/Enterprise Pick up",                    terminal: "Terminal B - West", location: "West",         sortOrder: 55 },
  { name: "Taxis",                                            terminal: "Terminal B - West", location: "West",         sortOrder: 56 },
  { name: "Garden",                                           terminal: "Terminal B - West", location: "West",         sortOrder: 57 },
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
];

const SEED_AREAS = RAW_SEED_AREAS.map((a) => ({
  ...a,
  name: renameSharedAreaName(a.name, a.terminal),
}));

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

  const REMOVED_STAFF_NAMES = ["Floraima Pinero Valdez", "Ashandre Longmore", "Marie Ingrid Daniel", "Jose Altagracia Maria"];
  const removedStaff = existingStaff.filter((s) => REMOVED_STAFF_NAMES.includes(s.name));
  if (removedStaff.length > 0) {
    const removedIds = removedStaff.map((s) => s.id);
    await db.delete(notificationsTable).where(inArray(notificationsTable.staffId, removedIds));
    await db.delete(staffLocationsTable).where(inArray(staffLocationsTable.staffId, removedIds));
    for (const s of removedStaff) {
      if (s.active) {
        await db.update(staffTable).set({ active: false }).where(eq(staffTable.id, s.id));
        console.log(`Marked ex-staff inactive: ${s.name}`);
      }
    }
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

  for (const { oldName, terminal, newName } of AREA_RENAME_MAP) {
    if (oldName === newName) continue;
    const result = await db
      .update(areasTable)
      .set({ name: newName })
      .where(and(eq(areasTable.name, oldName), eq(areasTable.terminal, terminal)))
      .returning({ id: areasTable.id });
    if (result.length > 0) {
      console.log(`Renamed area ${oldName} (${terminal}) → ${newName}`);
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
