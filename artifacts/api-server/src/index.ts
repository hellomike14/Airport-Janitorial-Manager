import app from "./app";
import { db, pool } from "@workspace/db";
import { staffTable, areasTable, taskTypesTable, notificationsTable, staffLocationsTable, tasksTable, assignmentsTable, schedulesTable, issuesTable, sharedPhotosTable } from "@workspace/db/schema";
import { eq, and, count, inArray, or, gte, like, sql } from "drizzle-orm";
import { renameSharedAreaName, AREA_RENAME_MAP } from "./area-renames";
import { AREAS_REPLACING_DEFAULTS } from "./area-tasks";
import {
  SEED_STAFF,
  REMOVED_STAFF_NAMES,
  REQUIRED_PRODUCTION_LOGIN_NAMES,
} from "./seed-data";
import { normalizeLoginEmail } from "./lib/loginIdentity";
import { startMessageEmailOutboxWorker } from "./lib/messageEmailOutbox";
import { startInspectorAssignmentEscalationWorker } from "./lib/inspectorTaskWorkflow";
import {
  STARTUP_ADVISORY_LOCK_NAME,
  withPostgresAdvisoryLock,
} from "./lib/startupAdvisoryLock";
import { selectCanonicalStaffRecord } from "./lib/startupStaffReconciliation";

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
  { name: "Level 4 - Row L-H",           terminal: "Terminal A - East", location: "East",         sortOrder: 1 },
  { name: "Level 3 - Row H-P",           terminal: "Terminal A - East", location: "East",         sortOrder: 2 },
  { name: "Level 2 - Row H-P",           terminal: "Terminal A - East", location: "East",         sortOrder: 3 },
  { name: "Level 1 - Row H-P",           terminal: "Terminal A - East", location: "East",         sortOrder: 4 },
  { name: "R2 - Avis",                   terminal: "Terminal A - East", location: "East",         sortOrder: 5 },
  { name: "R1 - Avis",                   terminal: "Terminal A - East", location: "East",         sortOrder: 6 },
  { name: "Taxis",                       terminal: "Terminal A - East", location: "East",         sortOrder: 7 },
  { name: "Check point",                 terminal: "Terminal A - East", location: "East",         sortOrder: 8 },
  { name: "Garden",                      terminal: "Terminal A - East", location: "East",         sortOrder: 9 },
  { name: "Level 4 - Row C-G",           terminal: "Terminal A - West", location: "West",         sortOrder: 10 },
  { name: "Level 3 - Row A-G",           terminal: "Terminal A - West", location: "West",         sortOrder: 11 },
  { name: "Level 2 - Row A-G",           terminal: "Terminal A - West", location: "West",         sortOrder: 12 },
  { name: "Level 1 - Row D-G",           terminal: "Terminal A - West", location: "West",         sortOrder: 13 },
  { name: "R1 - Enterprises",            terminal: "Terminal A - West", location: "West",         sortOrder: 14 },
  { name: "R1 - Hertz",                  terminal: "Terminal A - West", location: "West",         sortOrder: 15 },
  { name: "Level 4 - Row C-G",                                terminal: "Terminal B - East", location: "East",         sortOrder: 16 },
  { name: "Level 3 - Row A-G",                                terminal: "Terminal B - East", location: "East",         sortOrder: 17 },
  { name: "Level 2 - Row A-G",                                terminal: "Terminal B - East", location: "East",         sortOrder: 18 },
  { name: "Level 1 - Row D-G",                                terminal: "Terminal B - East", location: "East",         sortOrder: 19 },
  { name: "R2 - Avis",                                        terminal: "Terminal B - East", location: "East",         sortOrder: 20 },
  { name: "R1 - Hertz/Enterprise Return",                     terminal: "Terminal B - East", location: "East",         sortOrder: 21 },
  { name: "Level 4 - Row H-M",                                terminal: "Terminal B - West", location: "West",         sortOrder: 22 },
  { name: "Level 3 - Row H-P",                                terminal: "Terminal B - West", location: "West",         sortOrder: 23 },
  { name: "Level 2 - Row H-P",                                terminal: "Terminal B - West", location: "West",         sortOrder: 24 },
  { name: "Level 1 - Row H-P",                                terminal: "Terminal B - West", location: "West",         sortOrder: 25 },
  { name: "R2 - Hertz",                                       terminal: "Terminal B - West", location: "West",         sortOrder: 26 },
  { name: "R1 - Aloma/Enterprise Pick up",                    terminal: "Terminal B - West", location: "West",         sortOrder: 27 },
  { name: "Taxis",                                            terminal: "Terminal B - West", location: "West",         sortOrder: 28 },
  { name: "Garden",                                           terminal: "Terminal B - West", location: "West",         sortOrder: 29 },
  { name: "Terminal C - Levels 1, 3, 5", terminal: "Terminal C", location: "Levels 1, 3, 5", sortOrder: 30 },
  { name: "Terminal C - Levels 2, 4, 6", terminal: "Terminal C", location: "Levels 2, 4, 6", sortOrder: 31 },
  { name: "Level 6 - C6 C59-C69",                             terminal: "Terminal C", location: "Level 6", sortOrder: 32 },
  { name: "Level 5 - C5 C59-C69",                             terminal: "Terminal C", location: "Level 5", sortOrder: 33 },
  { name: "Level 5 - Pedestrian Crossing",                    terminal: "Terminal C", location: "Level 5", sortOrder: 34 },
  { name: "Level 4 - C4 C59-C69",                             terminal: "Terminal C", location: "Level 4", sortOrder: 35 },
  { name: "Level 4 - Driveway",                               terminal: "Terminal C", location: "Level 4", sortOrder: 36 },
  { name: "Level 3 - C3 C59-C69",                             terminal: "Terminal C", location: "Level 3", sortOrder: 37 },
  { name: "Level 3 - Driveway/Pedestrian Walkway to trains",  terminal: "Terminal C", location: "Level 3", sortOrder: 38 },
  { name: "Level 3 - Pedestrian Walkway",                     terminal: "Terminal C", location: "Level 3", sortOrder: 39 },
  { name: "Level 2 - C2 Avis",                                terminal: "Terminal C", location: "Level 2", sortOrder: 40 },
  { name: "Level 2 - Pick up/Return Hertz, Return Hertz Pick up", terminal: "Terminal C", location: "Level 2", sortOrder: 41 },
  { name: "Level 2 - Pedestrian Walkway",                     terminal: "Terminal C", location: "Level 2", sortOrder: 42 },
  { name: "Level 1 - C1 Enterprise Return",                   terminal: "Terminal C", location: "Level 1", sortOrder: 43 },
  { name: "Level 1 - Sixt Return/Pick up",                    terminal: "Terminal C", location: "Level 1", sortOrder: 44 },
  { name: "Level 1 - Pedestrian Walkway",                     terminal: "Terminal C", location: "Level 1", sortOrder: 45 },
  { name: "Top Terminal - Levels 4-11",  terminal: "Top Terminal", location: "Levels 4-11", sortOrder: 46 },
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



async function seed() {
  // Startup-safe DDL guard: ensures the `archived` column exists in
  // environments where `drizzle-kit push` has not been run yet. Idempotent.
  await db.execute(
    sql`ALTER TABLE "areas" ADD COLUMN IF NOT EXISTS "archived" boolean NOT NULL DEFAULT false`
  );

  // Startup-safe DDL guard for the in-app messaging tables. Idempotent.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "conversations" (
      "id" serial PRIMARY KEY,
      "participant_a_id" integer NOT NULL REFERENCES "staff"("id"),
      "participant_b_id" integer NOT NULL REFERENCES "staff"("id"),
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "conversations_participants_unique"
      ON "conversations" ("participant_a_id", "participant_b_id")
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'conversations_participants_ordered'
      ) THEN
        ALTER TABLE "conversations"
          ADD CONSTRAINT "conversations_participants_ordered"
          CHECK ("participant_a_id" < "participant_b_id");
      END IF;
    END $$
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "messages" (
      "id" serial PRIMARY KEY,
      "conversation_id" integer NOT NULL REFERENCES "conversations"("id"),
      "sender_id" integer NOT NULL REFERENCES "staff"("id"),
      "body" text NOT NULL,
      "is_read" boolean NOT NULL DEFAULT false,
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  // Group messaging additions: make 1:1 participant columns nullable, add
  // is_group / group_name columns, and create the participants table.
  await db.execute(sql`ALTER TABLE "conversations" ALTER COLUMN "participant_a_id" DROP NOT NULL`);
  await db.execute(sql`ALTER TABLE "conversations" ALTER COLUMN "participant_b_id" DROP NOT NULL`);
  await db.execute(sql`ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "is_group" boolean NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "group_name" text`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "conversation_participants" (
      "id" serial PRIMARY KEY,
      "conversation_id" integer NOT NULL REFERENCES "conversations"("id"),
      "staff_id" integer NOT NULL REFERENCES "staff"("id"),
      "last_read_at" timestamp,
      "joined_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "conversation_participants_unique"
      ON "conversation_participants" ("conversation_id", "staff_id")
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "conversation_archives" (
      "conversation_id" integer NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
      "staff_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
      "archived_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "conversation_archives_unique"
      ON "conversation_archives" ("conversation_id", "staff_id")
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "inbound_email_messages" (
      "provider_message_id" text PRIMARY KEY,
      "conversation_id" integer NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
      "sender_id" integer NOT NULL REFERENCES "staff"("id"),
      "message_id" integer REFERENCES "messages"("id") ON DELETE SET NULL,
      "received_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    ALTER TABLE "messages"
      ADD COLUMN IF NOT EXISTS "client_request_id" text
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "messages_sender_client_request_unique"
      ON "messages" ("sender_id", "client_request_id")
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "message_email_outbox" (
      "id" serial PRIMARY KEY,
      "message_id" integer NOT NULL UNIQUE REFERENCES "messages"("id") ON DELETE CASCADE,
      "conversation_id" integer NOT NULL,
      "inspector_id" integer NOT NULL,
      "supervisor_id" integer NOT NULL,
      "inspector_email" text NOT NULL,
      "inspector_name" text NOT NULL,
      "supervisor_name" text NOT NULL,
      "message_body" text NOT NULL,
      "status" text NOT NULL DEFAULT 'pending'
        CHECK ("status" IN ('pending', 'sending', 'retrying', 'accepted', 'disabled', 'not_configured', 'failed')),
      "attempt_count" integer NOT NULL DEFAULT 0 CHECK ("attempt_count" >= 0),
      "next_attempt_at" timestamp NOT NULL DEFAULT now(),
      "locked_at" timestamp,
      "lock_token" text,
      "last_error" text,
      "accepted_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "message_email_outbox_ready_idx"
      ON "message_email_outbox" ("status", "next_attempt_at")
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "inspector_task_links" (
      "task_id" integer PRIMARY KEY REFERENCES "tasks"("id") ON DELETE CASCADE,
      "source_message_id" integer NOT NULL UNIQUE REFERENCES "messages"("id") ON DELETE RESTRICT,
      "conversation_id" integer NOT NULL REFERENCES "conversations"("id") ON DELETE RESTRICT,
      "inspector_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT,
      "supervisor_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT,
      "assignment_method" text NOT NULL
        CHECK ("assignment_method" IN ('fresh_gps', 'area_roster_workload')),
      "target_latitude" double precision,
      "target_longitude" double precision,
      "due_at" timestamp NOT NULL,
      "escalated_at" timestamp,
      "escalation_staff_id" integer REFERENCES "staff"("id") ON DELETE SET NULL,
      "completion_message_id" integer UNIQUE REFERENCES "messages"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "inspector_task_links_due_idx"
      ON "inspector_task_links" ("due_at")
      WHERE "escalated_at" IS NULL
  `);

  // Clerk migration: personal PINs are gone — drop the legacy hash column so
  // no PIN hashes linger in any environment (dev or production).
  await db.execute(sql`ALTER TABLE "staff" DROP COLUMN IF EXISTS "password"`);
  await db.execute(sql`
    ALTER TABLE "staff"
      ADD COLUMN IF NOT EXISTS "login_enabled" boolean NOT NULL DEFAULT true
  `);

  // This address is an email-only notification recipient, never an app user.
  // Match both its historical staff name and address so the revocation is
  // idempotent across databases with partially edited legacy data.
  await db.execute(sql`
    UPDATE "staff"
      SET "active" = false, "login_enabled" = false
    WHERE lower(btrim(coalesce("email", ''))) = 'msutherland@marvolenterprises.com'
       OR lower(btrim("name")) = 'marcell sutherland'
  `);

  // Email is the join key between Clerk accounts and staff records, so it
  // must be unambiguous among active staff. Clear duplicate emails first
  // (keep the lowest id; the others are flagged as "no email" in the admin
  // Staff page), then enforce case-insensitive uniqueness going forward.
  await db.execute(sql`
    UPDATE "staff" s SET "email" = NULL
    WHERE s."active" = true AND s."login_enabled" = true
      AND s."email" IS NOT NULL AND btrim(s."email") != ''
      AND EXISTS (
        SELECT 1 FROM "staff" o
        WHERE o."active" = true AND o."login_enabled" = true
          AND o."email" IS NOT NULL AND btrim(o."email") != ''
          AND lower(btrim(o."email")) = lower(btrim(s."email")) AND o."id" < s."id"
      )
  `);
  // Replace the legacy index: it did not trim addresses or distinguish
  // disabled login identities from staff who are allowed into the app.
  await db.execute(sql`
    DROP INDEX IF EXISTS "staff_email_active_unique"
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "staff_login_email_unique"
      ON "staff" (lower(btrim("email")))
      WHERE "email" IS NOT NULL AND btrim("email") != ''
        AND "active" = true AND "login_enabled" = true
  `);

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
        active: true,
      }))
    );
    console.log(`Seeded: ${toInsert.length} staff members (${toInsert.map((s) => s.name).join(", ")})`);
  }

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

  // Reconcile duplicate management rows. The seed-rename logic below has, in
  // the past, renamed an existing admin/inspector row to a seeded name even
  // when another row already had that name, leaving two identical tiles on
  // the login screen. Hard-merging these rows is unsafe: a staff id can be
  // present in direct/group conversations, message senders, per-user archive
  // state, inbound-email idempotency, and an in-flight email outbox item. A
  // collision in any of those unique relationships can make startup fail or
  // corrupt conversation history. Instead, deterministically retain one
  // canonical login and deactivate every extra profile. All historical FKs
  // and outbox rows remain referentially intact because no id is deleted or
  // rewritten.
  const MGMT_ROLES = new Set(["admin", "inspector", "supervisor"]);
  const mgmtSeeds = SEED_STAFF.filter((staff) => MGMT_ROLES.has(staff.role));
  const canonicalManagementStaffIds = new Map<string, number>();
  await db.transaction(async (tx) => {
    const liveStaff = await tx.select().from(staffTable);
    for (const seedEntry of mgmtSeeds) {
      const activeCandidates = liveStaff.filter(
        (staff) =>
          staff.name === seedEntry.name &&
          staff.active &&
          MGMT_ROLES.has(staff.role),
      );
      if (activeCandidates.length < 2) continue;

      const survivor = selectCanonicalStaffRecord(
        activeCandidates,
        seedEntry.email,
      )!;
      const duplicateIds = activeCandidates
        .filter((candidate) => candidate.id !== survivor.id)
        .map((candidate) => candidate.id);

      await tx
        .update(staffTable)
        .set({ active: false, loginEnabled: false })
        .where(inArray(staffTable.id, duplicateIds));
      canonicalManagementStaffIds.set(seedEntry.name, survivor.id);
      console.log(
        `Reconciled duplicate ${survivor.role} "${survivor.name}": kept login id=${survivor.id}, deactivated ids=${duplicateIds.join(",")}`,
      );
    }
  });

  // One earlier seed used "Jeanfranco Perez" rather than the canonical
  // "JeanFranco Perez", creating two active records in production. Apply the
  // same non-destructive policy used for management duplicates: retain all
  // historical references and disable the typo profile once the canonical
  // profile exists.
  const [canonicalJeanFranco] = await db
    .select({ id: staffTable.id })
    .from(staffTable)
    .where(and(eq(staffTable.name, "JeanFranco Perez"), eq(staffTable.active, true)))
    .limit(1);
  if (canonicalJeanFranco) {
    const deactivatedTypoRows = await db
      .update(staffTable)
      .set({ active: false, loginEnabled: false })
      .where(and(eq(staffTable.name, "Jeanfranco Perez"), eq(staffTable.active, true)))
      .returning({ id: staffTable.id });
    if (deactivatedTypoRows.length > 0) {
      console.log(
        `Deactivated typo staff profiles for JeanFranco Perez: ids=${deactivatedTypoRows.map((row) => row.id).join(",")}`,
      );
    }
  }

  // Re-fetch the staff table so identity reconciliation sees the post-insert,
  // post-merge state of the world. The original `existingStaff` snapshot was
  // loaded before new seed rows were inserted and duplicate rows were merged.
  const currentStaff = await db.select().from(staffTable);

  for (const seedEntry of SEED_STAFF) {
    const sameName = currentStaff.filter(
      (staff) => staff.name === seedEntry.name,
    );
    const mappedCanonicalId = canonicalManagementStaffIds.get(seedEntry.name);
    const existing =
      (mappedCanonicalId === undefined
        ? undefined
        : sameName.find((staff) => staff.id === mappedCanonicalId)) ??
      selectCanonicalStaffRecord(
        sameName.filter((staff) => staff.active),
        seedEntry.email,
      ) ??
      selectCanonicalStaffRecord(sameName, seedEntry.email);
    if (!existing) continue;

    const updates: Partial<typeof staffTable.$inferInsert> = {};
    if (seedEntry.role !== existing.role) updates.role = seedEntry.role;
    if (REQUIRED_PRODUCTION_LOGIN_NAMES.has(seedEntry.name)) {
      if (!existing.active) updates.active = true;
      if (!existing.loginEnabled) updates.loginEnabled = true;
    }
    if (seedEntry.email) {
      const email = normalizeLoginEmail(seedEntry.email);
      const collision = currentStaff.find(
        (staff) =>
          staff.id !== existing.id &&
          staff.active &&
          staff.loginEnabled &&
          staff.email !== null &&
          normalizeLoginEmail(staff.email) === email,
      );
      if (collision) {
        throw new Error(
          `Cannot assign login email ${email} to ${existing.name}; it is already used by ${collision.name} (staff #${collision.id})`,
        );
      }
      if (email !== existing.email) updates.email = email;
    }

    if (Object.keys(updates).length > 0) {
      await db.update(staffTable).set(updates).where(eq(staffTable.id, existing.id));
      if (updates.role) existing.role = updates.role;
      if (updates.email !== undefined) existing.email = updates.email;
      if (updates.active !== undefined) existing.active = updates.active;
      if (updates.loginEnabled !== undefined) {
        existing.loginEnabled = updates.loginEnabled;
      }
      console.log(`Updated seeded staff identity: ${existing.name}`);
    }
  }

  // Defense in depth: a later seed/admin edit must not accidentally restore
  // application access to the notification-only recipient.
  await db.execute(sql`
    UPDATE "staff"
      SET "active" = false, "login_enabled" = false
    WHERE lower(btrim(coalesce("email", ''))) = 'msutherland@marvolenterprises.com'
       OR lower(btrim("name")) = 'marcell sutherland'
  `);

  // Run the rename + merge + archive cleanup in a single transaction so
  // either every reference is re-pointed and every duplicate cleared, or
  // none of it lands.
  await db.transaction(async (tx) => {
  for (const { oldName, terminal, newName } of AREA_RENAME_MAP) {
    if (oldName === newName) continue;
    const result = await tx
      .update(areasTable)
      .set({ name: newName })
      .where(and(eq(areasTable.name, oldName), eq(areasTable.terminal, terminal)))
      .returning({ id: areasTable.id });
    if (result.length > 0) {
      console.log(`Renamed area ${oldName} (${terminal}) → ${newName}`);
    }
  }

  // Merge duplicate area rows into their canonical counterpart. For each
  // mapping, references in tasks/assignments/schedules/issues/shared photos
  // are re-pointed at the canonical row and the duplicate row is then
  // hard-deleted. If the canonical row does not yet exist (fresh DB or
  // partial migration), the duplicate is renamed in place instead.
  const AREA_MERGE_PLAN: Array<{
    from: { name: string; terminal: string };
    to: { name: string; terminal: string };
  }> = [
    // "Taxi Stand" → renamed canonical "Terminal X — Taxis"
    { from: { name: "Taxi Stand", terminal: "Terminal A - East" }, to: { name: renameSharedAreaName("Taxis", "Terminal A - East"), terminal: "Terminal A - East" } },
    { from: { name: "Taxi Stand", terminal: "Terminal B - West" }, to: { name: renameSharedAreaName("Taxis", "Terminal B - West"), terminal: "Terminal B - West" } },
    // "Check Point" / "Checkpoint" → canonical "Check point" (single 'p').
    // Order matters: rename "Check Point" (canonical id 74) into the target
    // name first so the second mapping merges "Checkpoint" (id 44) into it.
    { from: { name: "Check Point", terminal: "Terminal A - East" }, to: { name: "Check point", terminal: "Terminal A - East" } },
    { from: { name: "Checkpoint", terminal: "Terminal A - East" }, to: { name: "Check point", terminal: "Terminal A - East" } },
    // One-time rename: "R2 - Enterprises" → "R1 - Enterprises" on Terminal A
    // West. Both rental-car rows on that side now live on Level R1. Done in
    // place via the merge plan so the area's id (and all FK references) are
    // preserved.
    { from: { name: "R2 - Enterprises", terminal: "Terminal A - West" }, to: { name: "R1 - Enterprises", terminal: "Terminal A - West" } },
    // Bare Terminal C "Level N" stub rows → corresponding summary row
    { from: { name: "Level 1", terminal: "Terminal C" }, to: { name: "Terminal C - Levels 1, 3, 5", terminal: "Terminal C" } },
    { from: { name: "Level 3", terminal: "Terminal C" }, to: { name: "Terminal C - Levels 1, 3, 5", terminal: "Terminal C" } },
    { from: { name: "Level 5", terminal: "Terminal C" }, to: { name: "Terminal C - Levels 1, 3, 5", terminal: "Terminal C" } },
    { from: { name: "Level 2", terminal: "Terminal C" }, to: { name: "Terminal C - Levels 2, 4, 6", terminal: "Terminal C" } },
    { from: { name: "Level 4", terminal: "Terminal C" }, to: { name: "Terminal C - Levels 2, 4, 6", terminal: "Terminal C" } },
    { from: { name: "Level 6", terminal: "Terminal C" }, to: { name: "Terminal C - Levels 2, 4, 6", terminal: "Terminal C" } },
  ];

  for (const { from, to } of AREA_MERGE_PLAN) {
    const fromRows = await tx
      .select({ id: areasTable.id })
      .from(areasTable)
      .where(and(eq(areasTable.name, from.name), eq(areasTable.terminal, from.terminal)));
    if (fromRows.length === 0) continue;

    const toRows = await tx
      .select({ id: areasTable.id })
      .from(areasTable)
      .where(and(eq(areasTable.name, to.name), eq(areasTable.terminal, to.terminal)));

    for (const fromRow of fromRows) {
      if (toRows.length === 0) {
        await tx
          .update(areasTable)
          .set({ name: to.name, terminal: to.terminal })
          .where(eq(areasTable.id, fromRow.id));
        console.log(`Renamed area #${fromRow.id} ${from.name} (${from.terminal}) → ${to.name} (${to.terminal})`);
        continue;
      }
      const toId = toRows[0].id;
      if (toId === fromRow.id) continue;
      await tx.update(tasksTable).set({ areaId: toId }).where(eq(tasksTable.areaId, fromRow.id));
      await tx.update(assignmentsTable).set({ areaId: toId }).where(eq(assignmentsTable.areaId, fromRow.id));
      await tx.update(schedulesTable).set({ areaId: toId }).where(eq(schedulesTable.areaId, fromRow.id));
      await tx.update(issuesTable).set({ areaId: toId }).where(eq(issuesTable.areaId, fromRow.id));
      await tx.update(sharedPhotosTable).set({ areaId: toId }).where(eq(sharedPhotosTable.areaId, fromRow.id));
      await tx.delete(areasTable).where(eq(areasTable.id, fromRow.id));
      console.log(`Merged area #${fromRow.id} (${from.name} / ${from.terminal}) → #${toId} (${to.name} / ${to.terminal})`);
    }
  }

  // Archive the obsolete parking garages and parking-level rows so they no
  // longer surface in Cleaning Areas, area filters, or Task Management while
  // any historical assignments/tasks/etc. linked to them remain intact.
  const PARKING_LEVEL_CODES = ["P1", "P2", "P3", "P4", "R1", "R2"] as const;
  const OBSOLETE_AREA_TARGETS: Array<{ name: string; terminal: string }> = [
    { name: "Terminal A - East Garage", terminal: "Terminal A - East" },
    { name: "Terminal A - West Garage", terminal: "Terminal A - West" },
    { name: "Terminal B - East Garage", terminal: "Terminal B - East" },
    { name: "Terminal B - West Garage", terminal: "Terminal B - West" },
  ];
  // Per-terminal parking-level archival exception list. Anything NOT in here
  // gets archived. Terminal A - West / Level P1 and Level P2 stay active (with
  // a trimmed bin task list — see area-tasks.ts) per task #38. Terminal B's
  // Level P1 West is fully removed, the duplicate Level P2 West is removed,
  // and every other P/R level row stays archived as before.
  const KEEP_ACTIVE_PARKING: Set<string> = new Set([
    "Terminal A - West||P1",
    "Terminal A - West||P2",
  ]);
  for (const lvl of PARKING_LEVEL_CODES) {
    for (const [terminal, side] of [
      ["Terminal A - East", "East"],
      ["Terminal A - West", "West"],
      ["Terminal B - East", "East"],
      ["Terminal B - West", "West"],
    ] as const) {
      if (KEEP_ACTIVE_PARKING.has(`${terminal}||${lvl}`)) continue;
      // Pre-rename form, e.g. "Level P1 - East".
      OBSOLETE_AREA_TARGETS.push({ name: `Level ${lvl} - ${side}`, terminal });
      // Post-rename form, e.g. "Terminal A — Level P1 East".
      const short = terminal.startsWith("Terminal A") ? "Terminal A" : "Terminal B";
      OBSOLETE_AREA_TARGETS.push({ name: `${short} — Level ${lvl} ${side}`, terminal });
    }
  }
  for (const target of OBSOLETE_AREA_TARGETS) {
    const matches = await tx
      .select({ id: areasTable.id, archived: areasTable.archived })
      .from(areasTable)
      .where(and(eq(areasTable.name, target.name), eq(areasTable.terminal, target.terminal)));
    for (const row of matches) {
      if (!row.archived) {
        await tx.update(areasTable).set({ archived: true }).where(eq(areasTable.id, row.id));
        console.log(`Archived obsolete area #${row.id} ${target.name} (${target.terminal})`);
      }
    }
  }

  // One-time un-archive for Terminal A - West / Level P1 + Level P2. A previous
  // version of OBSOLETE_AREA_TARGETS archived these unconditionally; task #38
  // requires them to be active again with a trimmed bin list (see area-tasks).
  const REACTIVATE_AREA_TARGETS: Array<{ name: string; terminal: string }> = [
    { name: "Level P1 - West", terminal: "Terminal A - West" },
    { name: "Terminal A — Level P1 West", terminal: "Terminal A - West" },
    { name: "Level P2 - West", terminal: "Terminal A - West" },
    { name: "Terminal A — Level P2 West", terminal: "Terminal A - West" },
  ];
  for (const target of REACTIVATE_AREA_TARGETS) {
    const matches = await tx
      .select({ id: areasTable.id, archived: areasTable.archived })
      .from(areasTable)
      .where(and(eq(areasTable.name, target.name), eq(areasTable.terminal, target.terminal)));
    for (const row of matches) {
      if (row.archived) {
        await tx.update(areasTable).set({ archived: false }).where(eq(areasTable.id, row.id));
        console.log(`Reactivated area #${row.id} ${target.name} (${target.terminal})`);
      }
    }
  }

  const existingAreas = await tx.select({ id: areasTable.id, name: areasTable.name, terminal: areasTable.terminal, sortOrder: areasTable.sortOrder }).from(areasTable);
  const areaKey = (name: string, terminal: string) => `${name}||${terminal}`;
  const existingAreaKeys = new Map(existingAreas.map((a) => [areaKey(a.name, a.terminal), a]));

  for (const area of existingAreas) {
    const seedArea = SEED_AREAS.find((a) => a.name === area.name && a.terminal === area.terminal);
    if (seedArea && seedArea.sortOrder !== area.sortOrder) {
      await tx.update(areasTable).set({ sortOrder: seedArea.sortOrder }).where(eq(areasTable.id, area.id));
      console.log(`Updated area ${area.name} (${area.terminal}): sortOrder → ${seedArea.sortOrder}`);
    }
  }

  for (const area of existingAreas) {
    const matchByName = SEED_AREAS.find((a) => a.name === area.name);
    if (matchByName && matchByName.terminal !== area.terminal) {
      const newKey = areaKey(area.name, matchByName.terminal);
      if (!existingAreaKeys.has(newKey)) {
        await tx.update(areasTable).set({ terminal: matchByName.terminal, sortOrder: matchByName.sortOrder }).where(eq(areasTable.id, area.id));
        existingAreaKeys.set(newKey, area);
        existingAreaKeys.delete(areaKey(area.name, area.terminal));
        console.log(`Updated area ${area.name}: terminal ${area.terminal} → ${matchByName.terminal}`);
      }
    }
  }

  const newAreas = SEED_AREAS.filter((a) => !existingAreaKeys.has(areaKey(a.name, a.terminal)));
  if (existingAreas.length === 0) {
    await tx.insert(areasTable).values(SEED_AREAS);
    console.log(`Seeded: ${SEED_AREAS.length} areas`);
  } else if (newAreas.length > 0) {
    await tx.insert(areasTable).values(newAreas);
    console.log(`Added areas: ${newAreas.map((a) => `${a.name} (${a.terminal})`).join(", ")}`);
  }
  });

  const [{ value: ttCount }] = await db.select({ value: count() }).from(taskTypesTable);
  if (ttCount === 0) {
    await db.insert(taskTypesTable).values(
      SEED_TASK_TYPES.map((t) => ({ taskName: t.taskName, taskOrder: t.taskOrder, active: true }))
    );
    console.log(`Seeded: ${SEED_TASK_TYPES.length} task types`);
  }

  // Clean up Before/After Lunch bin tasks that were auto-generated for terminals
  // that should not receive the Terminal-A-specific R1-West / R2-East lists.
  // Names are queried in their renamed form (post AREA_RENAME_MAP migration).
  const STRAY_LUNCH_BIN_AREAS: Array<{ name: string; terminal: string; label: string }> = [
    {
      name: renameSharedAreaName("Level R1 - West", "Terminal B - West"),
      terminal: "Terminal B - West",
      label: "R1-West bin tasks from Terminal B - West",
    },
    {
      name: renameSharedAreaName("Level R2 - East", "Terminal B - East"),
      terminal: "Terminal B - East",
      label: "R2-East bin tasks from Terminal B - East",
    },
  ];

  for (const target of STRAY_LUNCH_BIN_AREAS) {
    const matchingAreas = await db
      .select({ id: areasTable.id })
      .from(areasTable)
      .where(and(eq(areasTable.name, target.name), eq(areasTable.terminal, target.terminal)));

    for (const area of matchingAreas) {
      const deleted = await db
        .delete(tasksTable)
        .where(
          and(
            eq(tasksTable.areaId, area.id),
            gte(tasksTable.taskOrder, 16),
            or(
              like(tasksTable.taskName, "Before Lunch%"),
              like(tasksTable.taskName, "After Lunch%")
            )
          )
        )
        .returning({ id: tasksTable.id });
      if (deleted.length > 0) {
        console.log(`Cleaned up ${deleted.length} duplicate ${target.label} (area ${area.id})`);
      }
    }
  }

  // Trim Terminal A - West / Level P1 West down to bins #1–#4. Any previously
  // generated "Clean trash bin #5" … "#11" rows for this area on any date are
  // removed (only the un-completed ones, to preserve historical completion
  // records the same way exclusions do for today's sheet).
  const STRAY_P1_WEST_BINS = [
    "Clean trash bin #5",
    "Clean trash bin #6",
    "Clean trash bin #7",
    "Clean trash bin #8",
    "Clean trash bin #9",
    "Clean trash bin #10",
    "Clean trash bin #11",
  ];
  const p1WestAreas = await db
    .select({ id: areasTable.id })
    .from(areasTable)
    .where(
      and(
        eq(areasTable.name, renameSharedAreaName("Level P1 - West", "Terminal A - West")),
        eq(areasTable.terminal, "Terminal A - West"),
      ),
    );
  for (const area of p1WestAreas) {
    const deleted = await db
      .delete(tasksTable)
      .where(
        and(
          eq(tasksTable.areaId, area.id),
          eq(tasksTable.completed, false),
          inArray(tasksTable.taskName, STRAY_P1_WEST_BINS),
        ),
      )
      .returning({ id: tasksTable.id });
    if (deleted.length > 0) {
      console.log(`Cleaned up ${deleted.length} stray P1-West bin tasks (area ${area.id})`);
    }
  }

  // Remove the 13 default task-type rows from areas whose area-specific bin
  // list fully replaces the defaults (Check point, Taxis on Terminal B-West).
  // Only un-completed rows are removed so historical completion records on
  // these areas stay intact.
  const DEFAULT_TASK_NAMES = SEED_TASK_TYPES.map((t) => t.taskName);
  // Derive the cleanup targets from AREAS_REPLACING_DEFAULTS so the single
  // configuration source in area-tasks.ts drives both the runtime task
  // generator and this one-time historical cleanup pass.
  for (const qualifiedKey of AREAS_REPLACING_DEFAULTS) {
    const sep = qualifiedKey.indexOf("::");
    if (sep === -1) continue;
    const terminal = qualifiedKey.slice(0, sep);
    const name = qualifiedKey.slice(sep + 2);
    const matches = await db
      .select({ id: areasTable.id })
      .from(areasTable)
      .where(and(eq(areasTable.name, name), eq(areasTable.terminal, terminal)));
    for (const area of matches) {
      const deleted = await db
        .delete(tasksTable)
        .where(
          and(
            eq(tasksTable.areaId, area.id),
            eq(tasksTable.completed, false),
            inArray(tasksTable.taskName, DEFAULT_TASK_NAMES),
          ),
        )
        .returning({ id: tasksTable.id });
      if (deleted.length > 0) {
        console.log(`Cleaned up ${deleted.length} default tasks from ${terminal} / ${name} (area ${area.id})`);
      }
    }
  }
}

async function start() {
  // Do not report healthy or accept authenticated traffic against a partially
  // migrated database. Replit autoscale can boot multiple instances at once,
  // so pin one PostgreSQL connection and hold a session advisory lock across
  // the complete DDL, seed, and reconciliation routine. A failed migration
  // still fails the deployment before the HTTP listener or outbox worker starts.
  await withPostgresAdvisoryLock(
    pool,
    STARTUP_ADVISORY_LOCK_NAME,
    async () => seed(),
  );
  startMessageEmailOutboxWorker();
  startInspectorAssignmentEscalationWorker();
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

start().catch((err) => {
  console.error("Server startup failed:", err);
  process.exit(1);
});
