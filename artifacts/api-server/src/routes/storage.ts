import { Router, raw, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import {
  ObjectStorageService,
  ObjectNotFoundError,
  UnsafeObjectError,
} from "../lib/objectStorage";
import {
  resolveActorStaffFromRequest,
  type StaffRow,
} from "../lib/actorSession";
import {
  MAX_UPLOAD_BYTES,
  PublicUploadRateLimiter,
  validateUploadMetadata,
} from "../lib/uploadRequestPolicy";
import {
  contentMatchesClaim,
  createUploadCapabilityToken,
  normalizeContentType,
  verifyUploadCapabilityToken,
} from "../lib/secureUpload";
import {
  canReadStoredObject,
  findStoredObjectReference,
} from "../lib/storedObjectAccess";
import {
  getClerkProxyHost,
  getClerkProxyProtocol,
} from "../middlewares/clerkProxyMiddleware";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const publicUploadLimiter = new PublicUploadRateLimiter();

/**
 * POST /storage/uploads/request-url
 *
 * Request a short-lived, signed upload capability. The actual PUT terminates
 * at this API so the server can enforce byte length and magic bytes before
 * committing anything to GCS; the response shape remains compatible with the
 * existing direct-upload clients.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  const { name, size, contentType, purpose } = parsed.data;
  let ownerStaffId: number | null = null;
  if (purpose === "staff-photo") {
    const actor = await resolveActorStaffFromRequest(req);
    if (actor.status !== "ok") {
      res.status(actor.status === "unauthenticated" ? 401 : 403).json({
        error: "A staff session is required to upload team photos",
      });
      return;
    }
    ownerStaffId = actor.staff.id;
  } else {
    // Applicant document signing is intentionally public and therefore every
    // request consumes both the per-client and process-wide abuse budget.
    const clientKey = req.ip || req.socket.remoteAddress || "unknown";
    const limit = publicUploadLimiter.check(clientKey);
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.retryAfterSeconds));
      res.status(429).json({ error: "Too many upload requests; try again later" });
      return;
    }
  }

  try {
    const normalizedType = normalizeContentType(contentType);
    if (!normalizedType) {
      res.status(400).json({ error: "File type is not allowed" });
      return;
    }
    const policyError = validateUploadMetadata({
      name,
      size,
      contentType: normalizedType,
      purpose,
    });
    if (policyError) {
      res.status(400).json({ error: policyError });
      return;
    }

    const objectPath = objectStorageService.createObjectEntityPath();
    const token = createUploadCapabilityToken({
      v: 1,
      objectPath,
      name,
      size,
      contentType: normalizedType,
      purpose,
      ownerStaffId,
      exp: Date.now() + 10 * 60 * 1000,
    });
    const host = getClerkProxyHost(req);
    const protocol = getClerkProxyProtocol(req);
    if (!host || !protocol) {
      res.status(400).json({ error: "Invalid public request host" });
      return;
    }
    const uploadURL = `${protocol}://${host}/api/storage/uploads/${token}`;

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
      }),
    );
  } catch (error) {
    console.error("Error generating upload URL:", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.put(
  "/storage/uploads/:capability",
  raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  async (req: Request, res: Response) => {
    const token = Array.isArray(req.params.capability)
      ? req.params.capability[0]
      : req.params.capability;
    const capability = token ? verifyUploadCapabilityToken(token) : null;
    if (!capability) {
      res.status(401).json({ error: "Upload capability is invalid or expired" });
      return;
    }

    const requestType = normalizeContentType(req.header("content-type"));
    if (requestType !== capability.contentType) {
      res.status(400).json({ error: "Upload Content-Type does not match the signed request" });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length !== capability.size) {
      res.status(400).json({ error: "Upload size does not match the signed request" });
      return;
    }
    if (!contentMatchesClaim(req.body, capability.contentType)) {
      res.status(400).json({ error: "File contents do not match the declared type" });
      return;
    }

    try {
      await objectStorageService.saveObjectEntityUpload(capability, req.body);
      res.status(201).end();
    } catch (error) {
      if (Number((error as { code?: number | string }).code) === 412) {
        res.status(409).json({ error: "Upload capability has already been used" });
        return;
      }
      console.error("Error storing verified upload:", error);
      res.status(500).json({ error: "Failed to store upload" });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file, {
      visibility: "public",
    });

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    console.error("Error serving public object:", error);
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * Objects are private by default. Trusted upload scope metadata and legacy
 * database references decide whether this actor may read the exact object.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const inspected = await objectStorageService.inspectObjectEntity(objectPath);
    const actor = res.locals.staffActor as StaffRow | undefined;
    if (!actor) {
      res.status(401).json({ error: "Login session required" });
      return;
    }
    const reference = inspected.verifiedRecord
      ? null
      : await findStoredObjectReference(objectPath);
    if (!canReadStoredObject(actor, inspected.verifiedRecord, reference)) {
      // Return 404 so a guessed UUID does not reveal whether sensitive HR
      // paperwork exists.
      res.status(404).json({ error: "Object not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(inspected.file, {
      visibility: "private",
      metadata: inspected.metadata,
      verifiedRecord: inspected.verifiedRecord,
    });

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    console.error("Error serving object:", error);
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    if (error instanceof UnsafeObjectError) {
      res.status(415).json({ error: "Stored object cannot be safely served" });
      return;
    }
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
