import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@workspace/db";
import { pettyCashReceiptAttachmentsTable, pettyCashReceiptUploadsTable } from "@workspace/db/schema";
import { actorStaffFromRequest } from "../lib/actorSession";
import { confidentialIdentity, digest } from "../lib/confidentialAccess";
import { DigitalOperationsError } from "../lib/digitalOperationsErrors";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { requireOperationsManager } from "../middlewares/requireOperationsManager";
import { requireStaffRole } from "../middlewares/requireStaffRole";
import { confidentialSameOrigin } from "./confidentialAccess";

const router = Router();
const objectStorageService = new ObjectStorageService();
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const allowedTypes = ["image/jpeg", "image/png", "image/webp"] as const;
const uploadBody = z.object({
  fileName: z.string().trim().min(1).max(180),
  contentType: z.enum(allowedTypes),
  sizeBytes: z.number().int().min(1).max(MAX_RECEIPT_BYTES),
}).strict();
const uuid = z.string().uuid();

router.use(requireStaffRole("admin", "supervisor"), requireOperationsManager);
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

function fail(status: number, code: string, message: string): never {
  throw new DigitalOperationsError(status, code, message);
}

function action(handler: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof DigitalOperationsError) {
        res.status(error.status).json({
          error: error.code,
          code: error.code,
          message: error.message,
        });
        return;
      }
      next(error);
    }
  };
}

async function currentIdentity(req: Request) {
  const identity = await confidentialIdentity(req);
  const actor = await actorStaffFromRequest(req);
  if (!identity || !actor || identity.staffId !== actor.id) {
    fail(401, "SESSION_REQUIRED", "Sign in again before working with receipt photos.");
  }
  return { actorId: actor.id, sessionHash: digest(identity.sessionId) };
}

function safeFileName(value: string) {
  const safe = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .trim()
    .slice(0, 120);
  return safe || "receipt-photo";
}

function matchesImage(contentType: string, bytes: Buffer) {
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  return contentType === "image/webp" && bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP";
}

router.post("/petty-cash/receipts/uploads", action(async (req, res) => {
  confidentialSameOrigin(req);
  const parsed = uploadBody.safeParse(req.body);
  if (!parsed.success) {
    fail(400, "INVALID_RECEIPT_UPLOAD", "Choose a JPEG, PNG or WebP receipt image up to 8 MB.");
  }
  const { actorId, sessionHash } = await currentIdentity(req);
  const recent = await db.select({ id: pettyCashReceiptUploadsTable.id })
    .from(pettyCashReceiptUploadsTable)
    .where(and(
      eq(pettyCashReceiptUploadsTable.actorId, actorId),
      gt(pettyCashReceiptUploadsTable.createdAt, new Date(Date.now() - 30 * 60_000)),
    ))
    .limit(10);
  if (recent.length >= 10) {
    fail(429, "RECEIPT_UPLOAD_RATE_LIMIT", "Wait before uploading more receipt photos.");
  }

  const id = randomUUID();
  const uploadUrl = await objectStorageService.getObjectEntityUploadURL("petty-cash/receipts-staging");
  const stagingPath = objectStorageService.normalizeObjectEntityPath(uploadUrl);
  const expectedPrefix = "/objects/petty-cash/receipts-staging/";
  if (!stagingPath.startsWith(expectedPrefix)) {
    fail(503, "RECEIPT_STORAGE_UNAVAILABLE", "Receipt storage is unavailable.");
  }
  const objectPath = `/objects/petty-cash/receipts/${id}`;
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  await db.insert(pettyCashReceiptUploadsTable).values({
    id,
    actorId,
    sessionHash,
    objectPath,
    stagingPath,
    fileName: safeFileName(parsed.data.fileName),
    contentType: parsed.data.contentType,
    sizeBytes: parsed.data.sizeBytes,
    expiresAt,
  });
  res.status(201).json({ uploadId: id, uploadUrl, expiresAt: expiresAt.toISOString() });
}));

router.post("/petty-cash/receipts/uploads/:uploadId/complete", action(async (req, res) => {
  confidentialSameOrigin(req);
  const uploadId = uuid.safeParse(req.params.uploadId);
  if (!uploadId.success) fail(400, "INVALID_RECEIPT_UPLOAD", "Receipt upload not found.");
  const { actorId, sessionHash } = await currentIdentity(req);
  const result = await db.transaction(async (tx) => {
    const [upload] = await tx.select().from(pettyCashReceiptUploadsTable)
      .where(eq(pettyCashReceiptUploadsTable.id, uploadId.data))
      .for("update").limit(1);
    if (!upload || upload.actorId !== actorId || upload.sessionHash !== sessionHash) {
      fail(404, "RECEIPT_UPLOAD_NOT_FOUND", "Receipt upload not found.");
    }
    if (upload.status === "attached") {
      fail(409, "RECEIPT_UPLOAD_ATTACHED", "This receipt is already part of a saved reconciliation.");
    }
    if (upload.status === "uploaded") {
      return { id: upload.id, fileName: upload.fileName, contentType: upload.contentType, sizeBytes: upload.sizeBytes };
    }
    if (upload.expiresAt <= new Date()) {
      fail(410, "RECEIPT_UPLOAD_EXPIRED", "This receipt upload expired. Choose the image again.");
    }
    let stored: Awaited<ReturnType<typeof objectStorageService.readObjectEntityBytes>>;
    try {
      stored = await objectStorageService.readObjectEntityBytes(upload.stagingPath, MAX_RECEIPT_BYTES);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        fail(409, "RECEIPT_UPLOAD_MISSING", "The photo did not finish uploading. Please try again.");
      }
      throw error;
    }
    if (stored.sizeBytes !== upload.sizeBytes ||
        stored.contentType !== upload.contentType ||
        !matchesImage(upload.contentType, stored.bytes)) {
      fail(400, "RECEIPT_IMAGE_INVALID", "The uploaded file did not match its declared image type or size.");
    }
    await objectStorageService.savePrivateObject(
      "petty-cash/receipts",
      upload.id,
      stored.bytes,
      upload.contentType,
    );
    await objectStorageService.removePrivateObject(upload.stagingPath);
    await tx.update(pettyCashReceiptUploadsTable)
      .set({ status: "uploaded" })
      .where(eq(pettyCashReceiptUploadsTable.id, upload.id));
    return { id: upload.id, fileName: upload.fileName, contentType: upload.contentType, sizeBytes: upload.sizeBytes };
  });
  res.json(result);
}));

router.delete("/petty-cash/receipts/uploads/:uploadId", action(async (req, res) => {
  confidentialSameOrigin(req);
  const uploadId = uuid.safeParse(req.params.uploadId);
  if (!uploadId.success) fail(400, "INVALID_RECEIPT_UPLOAD", "Receipt upload not found.");
  const { actorId, sessionHash } = await currentIdentity(req);
  await db.transaction(async (tx) => {
    const [upload] = await tx.select().from(pettyCashReceiptUploadsTable)
      .where(eq(pettyCashReceiptUploadsTable.id, uploadId.data))
      .for("update").limit(1);
    if (!upload || upload.actorId !== actorId || upload.sessionHash !== sessionHash) {
      fail(404, "RECEIPT_UPLOAD_NOT_FOUND", "Receipt upload not found.");
    }
    if (upload.status === "attached") {
      fail(409, "RECEIPT_ALREADY_ATTACHED", "A saved receipt cannot be removed because its reconciliation history refers to it.");
    }
    await objectStorageService.removePrivateObject(upload.stagingPath);
    await objectStorageService.removePrivateObject(upload.objectPath);
    await tx.delete(pettyCashReceiptUploadsTable)
      .where(eq(pettyCashReceiptUploadsTable.id, upload.id));
  });
  res.status(204).end();
}));

async function sendReceipt(attachmentIdRaw: string, res: Response, disposition: "inline" | "attachment") {
  const attachmentId = uuid.safeParse(attachmentIdRaw);
  if (!attachmentId.success) fail(404, "RECEIPT_NOT_FOUND", "Receipt photo not found.");
  const [receipt] = await db.select({
    id: pettyCashReceiptAttachmentsTable.id,
    recordId: pettyCashReceiptAttachmentsTable.recordId,
    fileName: pettyCashReceiptUploadsTable.fileName,
    contentType: pettyCashReceiptUploadsTable.contentType,
    objectPath: pettyCashReceiptUploadsTable.objectPath,
    sizeBytes: pettyCashReceiptUploadsTable.sizeBytes,
    status: pettyCashReceiptUploadsTable.status,
  })
    .from(pettyCashReceiptAttachmentsTable)
    .innerJoin(pettyCashReceiptUploadsTable, eq(
      pettyCashReceiptAttachmentsTable.id,
      pettyCashReceiptUploadsTable.id,
    ))
    .where(eq(pettyCashReceiptAttachmentsTable.id, attachmentId.data))
    .limit(1);
  if (!receipt || receipt.status !== "attached") {
    fail(404, "RECEIPT_NOT_FOUND", "Receipt photo not found.");
  }
  const stored = await objectStorageService.readObjectEntityBytes(receipt.objectPath, MAX_RECEIPT_BYTES);
  if (stored.sizeBytes !== receipt.sizeBytes || stored.contentType !== receipt.contentType ||
      !matchesImage(receipt.contentType, stored.bytes)) {
    fail(503, "RECEIPT_FILE_UNAVAILABLE", "Receipt photo is unavailable.");
  }
  res.setHeader("Content-Type", receipt.contentType);
  res.setHeader("Content-Length", String(stored.sizeBytes));
  res.setHeader("Content-Disposition", `${disposition}; filename="${safeFileName(receipt.fileName)}"`);
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.end(stored.bytes);
}

router.get("/petty-cash/receipts/:attachmentId/preview", action(async (req, res) => {
  const attachmentId = req.params.attachmentId;
  await sendReceipt(Array.isArray(attachmentId) ? "" : attachmentId, res, "inline");
}));
router.get("/petty-cash/receipts/:attachmentId/download", action(async (req, res) => {
  const attachmentId = req.params.attachmentId;
  await sendReceipt(Array.isArray(attachmentId) ? "" : attachmentId, res, "attachment");
}));

export default router;
