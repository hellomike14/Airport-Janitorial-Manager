import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, eq, desc, ne, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { staffTable, trainingProgressTable, trainingAcknowledgmentsTable } from "@workspace/db/schema";
import { actorStaffFromRequest } from "../lib/actorSession";
import { requireStaffRole } from "../middlewares/requireStaffRole";
import { employeeTraining } from "../lib/employeeTrainingConfig";
import { fullyWatched, mergeWatchRanges, normalizedSignature, watchedSeconds, watchInterval, watchCreditClock } from "../lib/trainingPolicy";

const router: IRouter = Router();
router.use(requireStaffRole("admin", "supervisor", "staff"));
const target = (staffId: number) => and(eq(trainingProgressTable.staffId, staffId),
  eq(trainingProgressTable.version, employeeTraining.version));
const publicTraining = {
  version: employeeTraining.version, title: employeeTraining.title,
  duration: employeeTraining.duration, videoUrl: employeeTraining.videoUrl,
};
function progressStatus(ranges: [number, number][]) {
  return { watchedSeconds: watchedSeconds(ranges), eligible: fullyWatched(ranges, employeeTraining.duration) };
}
async function ownStatus(staffId: number, name: string) {
  const [progress, history] = await Promise.all([
    db.select().from(trainingProgressTable).where(target(staffId)),
    db.select().from(trainingAcknowledgmentsTable).where(eq(trainingAcknowledgmentsTable.staffId, staffId))
      .orderBy(desc(trainingAcknowledgmentsTable.completedAt)),
  ]);
  return { training: publicTraining, staff: { id: staffId, name },
    ...progressStatus(progress[0]?.watchedRanges ?? []),
    acknowledgment: history.find(row => row.version === employeeTraining.version) ?? null, history };
}

router.get("/status", async (req, res) => {
  const actor = (await actorStaffFromRequest(req))!;
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await ownStatus(actor.id, actor.name));
});

router.post("/session", async (req, res) => {
  const actor = (await actorStaffFromRequest(req))!;
  const sessionId = randomUUID();
  await db.insert(trainingProgressTable).values({
    staffId: actor.id, version: employeeTraining.version, sessionId,
  }).onConflictDoUpdate({
    target: [trainingProgressTable.staffId, trainingProgressTable.version],
    set: { sessionId, lastPosition: 0, wasPlaying: false,
      updatedAt: sql`greatest(${trainingProgressTable.updatedAt}, now())` },
  });
  res.json({ sessionId });
});

const heartbeat = z.object({
  sessionId: z.string().uuid(), version: z.literal(employeeTraining.version),
  position: z.number().min(0).max(employeeTraining.duration + 0.25),
  playing: z.boolean(), seeking: z.boolean(), rate: z.number().min(0.25).max(2),
}).strict();
router.post("/progress", async (req, res) => {
  const parsed = heartbeat.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid training progress or version" }); return; }
  const actor = (await actorStaffFromRequest(req))!;
  const result = await db.transaction(async tx => {
    const [progress] = await tx.select().from(trainingProgressTable).where(target(actor.id)).for("update");
    if (!progress || progress.sessionId !== parsed.data.sessionId) return null;
    const now = new Date();
    const interval = watchInterval(progress, parsed.data, now);
    const ranges = mergeWatchRanges(
      interval ? [...progress.watchedRanges, interval] : progress.watchedRanges,
      employeeTraining.duration);
    await tx.update(trainingProgressTable).set({
      watchedRanges: ranges, lastPosition: parsed.data.position,
      wasPlaying: parsed.data.playing && !parsed.data.seeking,
      updatedAt: watchCreditClock(progress.updatedAt, interval, parsed.data.rate, now),
    }).where(eq(trainingProgressTable.id, progress.id));
    return progressStatus(ranges);
  });
  if (!result) { res.status(409).json({ error: "Training session changed. Reload this page before continuing." }); return; }
  res.json(result);
});

const attestation = z.object({
  version: z.literal(employeeTraining.version), watched: z.literal(true),
  understood: z.literal(true), fullName: z.string().trim().min(1).max(200),
}).strict();
router.post("/acknowledgment", async (req, res) => {
  const parsed = attestation.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Confirm both statements and sign the current training version." }); return; }
  const actor = (await actorStaffFromRequest(req))!;
  if (normalizedSignature(parsed.data.fullName) !== normalizedSignature(actor.name)) {
    res.status(400).json({ error: "Your signature must match the full name on your signed-in staff account." }); return;
  }
  const completed = await db.transaction(async tx => {
    const existing = await tx.select().from(trainingAcknowledgmentsTable).where(and(
      eq(trainingAcknowledgmentsTable.staffId, actor.id), eq(trainingAcknowledgmentsTable.version, employeeTraining.version)));
    if (existing.length) return true;
    const [progress] = await tx.select().from(trainingProgressTable).where(target(actor.id)).for("update");
    if (!progress || !fullyWatched(progress.watchedRanges, employeeTraining.duration)) return false;
    await tx.insert(trainingAcknowledgmentsTable).values({
      staffId: actor.id, version: employeeTraining.version, trainingTitle: employeeTraining.title,
      videoSha256: employeeTraining.videoSha256, signature: parsed.data.fullName,
      staffName: actor.name, watchedConfirmation: true, understoodConfirmation: true,
      // completedAt is generated by the database, never accepted from the client.
    }).onConflictDoNothing({ target: [trainingAcknowledgmentsTable.staffId, trainingAcknowledgmentsTable.version] });
    return true;
  });
  if (!completed) { res.status(409).json({ error: "Watch the full training video before signing." }); return; }
  res.json(await ownStatus(actor.id, actor.name));
});

router.get("/review", requireStaffRole("admin", "supervisor"), async (_req, res) => {
  const [people, progress, history] = await Promise.all([
    db.select({ staffId: staffTable.id, name: staffTable.name, active: staffTable.active,
      formerEmployee: staffTable.formerEmployee }).from(staffTable).where(and(
        ne(staffTable.role, "inspector"), eq(staffTable.formerEmployee, false))),
    db.select().from(trainingProgressTable).where(eq(trainingProgressTable.version, employeeTraining.version)),
    db.select().from(trainingAcknowledgmentsTable).orderBy(desc(trainingAcknowledgmentsTable.completedAt)),
  ]);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ training: publicTraining, employees: people.map(person => {
    const records = history.filter(row => row.staffId === person.staffId);
    const acknowledgment = records.find(row => row.version === employeeTraining.version) ?? null;
    return { ...person, status: acknowledgment ? "completed" : "pending",
      ...progressStatus(progress.find(row => row.staffId === person.staffId)?.watchedRanges ?? []),
      acknowledgment, history: records };
  }) });
});

export default router;
