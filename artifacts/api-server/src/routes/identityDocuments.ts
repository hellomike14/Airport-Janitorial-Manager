import { Router, type Request, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { onboardingHiresTable as hires, staffTable as staff, identityDocumentPhotosTable as photos, identityDocumentEventsTable as events } from "@workspace/db/schema";
import { and, eq, desc, isNotNull, isNull, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { actorStaffFromRequest } from "../lib/actorSession";
import { hash, identityDocumentStorage } from "../lib/identityDocumentStorage";
import { IDENTITY_TYPES, MAX_IDENTITY_BYTES, IdentityDocumentError, normalizeIdentityPhoto } from "../lib/identityPhotoProcessing";
import { ObjectNotFoundError } from "../lib/objectStorage";

type Actor = NonNullable<Awaited<ReturnType<typeof actorStaffFromRequest>>>;
type Photo = typeof photos.$inferSelect;
const category = z.enum(["identity", "work_authorization", "social_security"]);
const side = z.enum(["front", "back"]);
const qualityReason = z.enum(["blurry", "glare", "cropped", "wrong_side", "other"]);
const positiveId = z.coerce.number().int().positive();
const uploadInput = z.object({
  hireId: positiveId, category, side, size: z.number().int().positive().max(MAX_IDENTITY_BYTES),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]),
  replacesId: z.string().uuid().nullable(),
}).strict();
const reviewInput = z.object({ status: z.enum(["reviewed", "needs_clearer_photo"]), reason: qualityReason.optional() }).strict()
  .refine(value => value.status !== "needs_clearer_photo" || value.reason, "Choose a photo-quality reason");

function dto(photo: Photo) {
  return {
    id: photo.id, hireId: photo.hireId, category: photo.category, side: photo.side, status: photo.status,
    uploadedAt: photo.uploadedAt, uploadedBy: { id: photo.uploadedById, name: photo.uploaderName },
    reviewedAt: photo.reviewedAt, reviewedBy: photo.reviewedById ? { id: photo.reviewedById, name: photo.reviewerName } : null,
    qualityReason: photo.qualityReason, replacesId: photo.replacesId, supersededAt: photo.supersededAt,
  };
}
export function canAccessIdentityHire(actor: Pick<Actor, "id" | "role">, hire: { staffId: number | null }) {
  return actor.role === "admin";
}
function audit(actor: Actor, hireId: number, action: string, photoId: string | null = null, details: string | null = null) {
  return { hireId, action, photoId, details, actorId: actor.id, actorName: actor.name };
}
async function ownHire(actor: Actor, id: number) {
  const [hire] = await db.select().from(hires).where(eq(hires.id, id)).limit(1);
  if (!hire || !canAccessIdentityHire(actor, hire)) throw new IdentityDocumentError(404, "Employee document record not found.");
  return hire;
}
async function ownPhoto(actor: Actor, id: string) {
  const [photo] = await db.select().from(photos).where(eq(photos.id, z.string().uuid().parse(id))).limit(1);
  if (!photo) throw new IdentityDocumentError(404, "Photograph not found.");
  await ownHire(actor, photo.hireId);
  return photo;
}
function activeWhere(hireId: number, cat: string, photoSide: string) {
  return and(eq(photos.hireId, hireId), eq(photos.category, cat as Photo["category"]), eq(photos.side, photoSide as Photo["side"]), isNotNull(photos.uploadedAt), isNull(photos.supersededAt));
}

export function createIdentityDocumentsRouter({
  resolveActor = actorStaffFromRequest, storage = identityDocumentStorage, normalize = normalizeIdentityPhoto,
}: {
  resolveActor?: (request: Request) => Promise<Actor | null>;
  storage?: typeof identityDocumentStorage; normalize?: typeof normalizeIdentityPhoto;
} = {}) {
  const router = Router();
  router.use("/identity-documents", async (req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const actor = await resolveActor(req);
    if (!actor) { res.status(401).json({ error: "Login session required" }); return; }
    if (actor.role !== "admin") { res.status(403).json({ error: "Only administrators may access HR documents" }); return; }
    res.locals.identityActor = actor;
    next();
  });
  const route = (action: RequestHandler): RequestHandler => async (req, res, next) => {
    try { await action(req, res, next); }
    catch (error) {
      if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid document information. Check the employee, category, side and photo size." }); return; }
      if (error instanceof IdentityDocumentError) { res.status(error.status).json({ error: error.message }); return; }
      if (error instanceof ObjectNotFoundError) { res.status(404).json({ error: "The photograph is unavailable. Upload it again or contact HR." }); return; }
      // Never log image bytes, document numbers, storage paths or signed URLs.
      console.error("Private identity document operation failed");
      res.status(503).json({ error: "Document service is temporarily unavailable. Please retry." });
    }
  };
  router.get("/identity-documents/context", route(async (_req, res) => {
    const actor: Actor = res.locals.identityActor;
    const records = await db.select({ id: hires.id, name: hires.name, staffId: hires.staffId, staffName: staff.name })
      .from(hires).leftJoin(staff, eq(staff.id, hires.staffId))
      .where(actor.role === "admin" ? undefined : eq(hires.staffId, actor.id)).orderBy(desc(hires.createdAt));
    const employees = actor.role === "admin" ? await db.select({ id: staff.id, name: staff.name }).from(staff)
      .where(and(eq(staff.active, true), eq(staff.formerEmployee, false), eq(staff.role, "staff"))) : [];
    res.json({ canManage: actor.role === "admin", hires: records, employees, maxBytes: MAX_IDENTITY_BYTES, acceptedTypes: IDENTITY_TYPES });
  }));
  router.put("/identity-documents/hires/:hireId/employee", route(async (req, res) => {
    const actor: Actor = res.locals.identityActor;
    if (actor.role !== "admin") throw new IdentityDocumentError(403, "Only HR administrators can link an employee.");
    const hireId = positiveId.parse(req.params.hireId);
    const { staffId } = z.object({ staffId: positiveId }).strict().parse(req.body);
    await db.transaction(async tx => {
      const [hire] = await tx.select().from(hires).where(eq(hires.id, hireId)).for("update");
      if (!hire) throw new IdentityDocumentError(404, "New hire not found.");
      if (hire.staffId !== null) throw new IdentityDocumentError(409, "This hire is already linked. Existing document ownership cannot be reassigned.");
      const [person] = await tx.select().from(staff).where(and(eq(staff.id, staffId), eq(staff.role, "staff"), eq(staff.active, true), eq(staff.formerEmployee, false)));
      if (!person) throw new IdentityDocumentError(400, "Choose an active employee account.");
      const [existing] = await tx.select({ id: hires.id }).from(hires).where(eq(hires.staffId, staffId));
      if (existing) throw new IdentityDocumentError(409, "This employee is already linked to another hire.");
      await tx.update(hires).set({ staffId }).where(eq(hires.id, hireId));
      await tx.insert(events).values(audit(actor, hireId, "employee_linked"));
    });
    res.json({ success: true });
  }));
  router.get("/identity-documents", route(async (req, res) => {
    const actor: Actor = res.locals.identityActor;
    const hireId = positiveId.parse(req.query.hireId);
    await ownHire(actor, hireId);
    const records = await db.select().from(photos).where(and(eq(photos.hireId, hireId), isNotNull(photos.uploadedAt))).orderBy(desc(photos.createdAt));
    const history = await db.select().from(events).where(eq(events.hireId, hireId)).orderBy(desc(events.createdAt)).limit(200);
    res.json({ photos: records.map(dto), events: history.map(event => ({
      id: event.id, photoId: event.photoId, action: event.action, details: event.details,
      actor: { id: event.actorId, name: event.actorName }, createdAt: event.createdAt,
    })) });
  }));
  router.post("/identity-documents/uploads", route(async (req, res) => {
    const actor: Actor = res.locals.identityActor;
    const input = uploadInput.parse(req.body);
    const hire = await ownHire(actor, input.hireId);
    if (!hire.staffId) throw new IdentityDocumentError(409, "Link this new hire to the correct employee account before uploading.");
    const id = randomUUID();
    const reservation = await storage.reserve();
    await db.transaction(async tx => {
      await tx.select({ id: hires.id }).from(hires).where(eq(hires.id, hire.id)).for("update");
      const [current] = await tx.select().from(photos).where(activeWhere(hire.id, input.category, input.side));
      if ((current?.id ?? null) !== input.replacesId) throw new IdentityDocumentError(409, "The document changed. Refresh the photographs before replacing it.");
      const pending = await tx.select({ id: photos.id }).from(photos).where(and(eq(photos.hireId, hire.id), isNull(photos.uploadedAt), gt(photos.createdAt, new Date(Date.now() - 30 * 60_000))));
      if (pending.length >= 10) throw new IdentityDocumentError(429, "Too many unfinished uploads. Cancel or wait before retrying.");
      await tx.insert(photos).values({
        id, hireId: hire.id, category: input.category, side: input.side,
        uploadedById: actor.id, uploaderName: actor.name, stagingPath: reservation.stagingPath,
        expectedBytes: input.size, inputType: input.contentType, replacesId: input.replacesId,
      });
    });
    res.status(201).json({ id, uploadURL: reservation.uploadURL });
  }));
  router.post("/identity-documents/uploads/:id/complete", route(async (req, res) => {
    const actor: Actor = res.locals.identityActor;
    const photo = await ownPhoto(actor, String(req.params.id));
    if (photo.uploadedById !== actor.id) throw new IdentityDocumentError(403, "Only the uploader can finish this upload.");
    if (photo.uploadedAt) { res.json(dto(photo)); return; }
    if (Date.now() - photo.createdAt.getTime() > 30 * 60_000) throw new IdentityDocumentError(410, "This upload expired. Select the photo and submit again.");
    const original = await storage.readStaging(photo.stagingPath, photo.expectedBytes);
    const jpeg = await normalize(original, photo.inputType);
    const originalPath = await storage.save(photo.id, "original", original, photo.inputType);
    const imagePath = await storage.save(photo.id, "image", jpeg, "image/jpeg");
    const completed = await db.transaction(async tx => {
      await tx.select({ id: hires.id }).from(hires).where(eq(hires.id, photo.hireId)).for("update");
      const [ticket] = await tx.select().from(photos).where(eq(photos.id, photo.id)).for("update");
      if (!ticket) throw new IdentityDocumentError(409, "This upload was cancelled. Submit again.");
      if (ticket.uploadedAt) return ticket;
      const [current] = await tx.select().from(photos).where(activeWhere(photo.hireId, photo.category, photo.side));
      if ((current?.id ?? null) !== photo.replacesId) throw new IdentityDocumentError(409, "A newer photograph was saved. Refresh and submit a new replacement.");
      const now = new Date();
      if (current) await tx.update(photos).set({ supersededAt: now }).where(eq(photos.id, current.id));
      const [saved] = await tx.update(photos).set({ uploadedAt: now, originalPath, imagePath, sha256: hash(original) }).where(eq(photos.id, photo.id)).returning();
      await tx.insert(events).values(audit(actor, photo.hireId, photo.replacesId ? "photo_replaced" : "photo_uploaded", photo.id));
      return saved;
    });
    await storage.removeStaging(photo.stagingPath);
    res.json(dto(completed));
  }));
  router.delete("/identity-documents/uploads/:id", route(async (req, res) => {
    const actor: Actor = res.locals.identityActor;
    const photo = await ownPhoto(actor, String(req.params.id));
    if (photo.uploadedById !== actor.id) throw new IdentityDocumentError(403, "Only the uploader can cancel this upload.");
    await db.transaction(async tx => {
      await tx.select({ id: hires.id }).from(hires).where(eq(hires.id, photo.hireId)).for("update");
      // Completed originals and audit records can never be deleted by cancel/retry.
      await tx.delete(photos).where(and(eq(photos.id, photo.id), isNull(photos.uploadedAt)));
    });
    if (!photo.uploadedAt) await storage.removeStaging(photo.stagingPath);
    res.json({ success: true });
  }));
  router.get("/identity-documents/:id/image", route(async (req, res) => {
    const actor: Actor = res.locals.identityActor;
    const photo = await ownPhoto(actor, String(req.params.id));
    if (!photo.uploadedAt || !photo.imagePath) throw new IdentityDocumentError(404, "This photograph has not been submitted.");
    const bytes = await storage.readImage(photo.imagePath);
    await db.insert(events).values(audit(actor, photo.hireId, "photo_viewed", photo.id));
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Disposition", 'inline; filename="private-document-photo.jpg"');
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.send(bytes);
  }));
  router.patch("/identity-documents/:id/review", route(async (req, res) => {
    const actor: Actor = res.locals.identityActor;
    if (actor.role !== "admin") throw new IdentityDocumentError(403, "Only HR administrators can review photographs.");
    const input = reviewInput.parse(req.body);
    const photo = await ownPhoto(actor, String(req.params.id));
    await db.transaction(async tx => {
      await tx.select({ id: hires.id }).from(hires).where(eq(hires.id, photo.hireId)).for("update");
      const [current] = await tx.select().from(photos).where(eq(photos.id, photo.id)).for("update");
      if (!current.uploadedAt || current.supersededAt) throw new IdentityDocumentError(409, "Review the current submitted version.");
      await tx.update(photos).set({
        status: input.status, qualityReason: input.status === "needs_clearer_photo" ? input.reason! : null,
        reviewedById: actor.id, reviewerName: actor.name, reviewedAt: new Date(),
      }).where(eq(photos.id, photo.id));
      await tx.insert(events).values(audit(actor, photo.hireId, input.status, photo.id, input.reason ?? null));
    });
    res.json({ success: true });
  }));
  return router;
}
export default createIdentityDocumentsRouter();
