import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { actorStaffFromRequest } from "../lib/actorSession";
import { db } from "@workspace/db";
import { objectUploadsTable, tasksTable, conversationsTable, conversationParticipantsTable, issuesTable, areasTable } from "@workspace/db/schema";
import { and, eq, or } from "drizzle-orm";
import { randomUUID } from "crypto";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const actor = await actorStaffFromRequest(req);
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }
  if (!actor && parsed.data.purpose !== "application_document") {
    res.status(401).json({ error: "Login session required" });
    return;
  }

  try {
    const { name, size, contentType, purpose, taskId, conversationId, issueId, areaId } = parsed.data;
    const imagePurpose = ["task_before", "task_after", "issue_before", "issue_after", "shared_photo"].includes(purpose);
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(contentType) ||
        (imagePurpose && !["image/jpeg", "image/png", "image/webp"].includes(contentType)) ||
        size > 10 * 1024 * 1024 ||
        ((purpose === "task_before" || purpose === "task_after") && !taskId) ||
         (purpose === "conversation_attachment" && !conversationId) ||
         (purpose === "issue_after" && !issueId) ||
         (purpose === "issue_before" && !issueId && !areaId) ||
         (purpose !== "application_document" && !actor)) {
      res.status(400).json({ error: "Invalid upload purpose, target, type, or size" }); return;
    }

    if (taskId) {
      const [task] = await db.select({ assignedToId: tasksTable.assignedToId }).from(tasksTable).where(eq(tasksTable.id, taskId));
      if (!task) { res.status(404).json({ error: "Upload target not found" }); return; }
      if (actor!.role === "staff" && task.assignedToId !== actor!.id) { res.status(403).json({ error: "Upload target access denied" }); return; }
    }
    if (conversationId) {
      const [conversation] = await db.select({ id: conversationsTable.id }).from(conversationsTable)
        .leftJoin(conversationParticipantsTable, eq(conversationParticipantsTable.conversationId, conversationsTable.id))
        .where(and(eq(conversationsTable.id, conversationId), or(eq(conversationsTable.participantAId, actor!.id), eq(conversationsTable.participantBId, actor!.id), eq(conversationParticipantsTable.staffId, actor!.id))));
      if (!conversation) { res.status(403).json({ error: "Upload target access denied" }); return; }
    }
    if (issueId) {
      const [issue] = await db.select({ reportedById: issuesTable.reportedById, assignedToId: issuesTable.assignedToId }).from(issuesTable).where(eq(issuesTable.id, issueId));
      if (!issue) { res.status(404).json({ error: "Upload target not found" }); return; }
      if (actor!.role === "staff" && issue.reportedById !== actor!.id && issue.assignedToId !== actor!.id) { res.status(403).json({ error: "Upload target access denied" }); return; }
    }
    if (purpose === "issue_before" && !issueId && areaId) {
      const [area] = await db.select({ id: areasTable.id }).from(areasTable).where(eq(areasTable.id, areaId));
      if (!area) { res.status(404).json({ error: "Upload target not found" }); return; }
    }

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    const applicantToken = purpose === "application_document" ? randomUUID() : null;
    await db.insert(objectUploadsTable).values({ objectPath, ownerStaffId: actor?.id ?? null, purpose, taskId: taskId ?? null, conversationId: conversationId ?? null, issueId: issueId ?? null, areaId: areaId ?? null, applicantToken, mimeType: contentType, sizeBytes: size });

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        uploadToken: applicantToken ?? undefined,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    console.error("Error generating upload URL:", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

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

    const response = await objectStorageService.downloadObject(file);

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
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const actor = await actorStaffFromRequest(req);
    if (!actor) {
      res.status(401).json({ error: "Login session required" });
      return;
    }
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const [metadata] = await db.select().from(objectUploadsTable).where(eq(objectUploadsTable.objectPath, objectPath));
    let allowed = actor.role === "admin";
    if (metadata) {
      allowed ||= metadata.ownerStaffId === actor.id;
      if (!allowed && metadata.taskId) {
        const [task] = await db.select({ assignedToId: tasksTable.assignedToId }).from(tasksTable).where(eq(tasksTable.id, metadata.taskId));
        allowed = task?.assignedToId === actor.id;
      }
      if (!allowed && metadata.conversationId) {
        const [conversation] = await db.select().from(conversationsTable).where(and(eq(conversationsTable.id, metadata.conversationId), or(eq(conversationsTable.participantAId, actor.id), eq(conversationsTable.participantBId, actor.id))));
        allowed = !!conversation;
      }
      if (!allowed && metadata.issueId) {
        const [issue] = await db.select({ reportedById: issuesTable.reportedById, assignedToId: issuesTable.assignedToId }).from(issuesTable).where(eq(issuesTable.id, metadata.issueId));
        allowed = actor.role === "supervisor" || actor.role === "inspector" || issue?.reportedById === actor.id || issue?.assignedToId === actor.id;
      }
      if (!allowed && metadata.purpose === "issue_before" && metadata.areaId) {
        allowed = actor.role === "supervisor" || actor.role === "inspector";
      }
      if (!allowed && metadata.purpose === "shared_photo") {
        allowed = true;
      }
      if (!allowed && metadata.purpose === "application_document" && metadata.claimedAt) {
        allowed = actor.role === "supervisor";
      }
    }
    if (!allowed) { res.status(403).json({ error: "Object access denied" }); return; }
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    // --- Protected route example (uncomment when using replit-auth) ---
    // if (!req.isAuthenticated()) {
    //   res.status(401).json({ error: "Unauthorized" });
    //   return;
    // }
    // const canAccess = await objectStorageService.canAccessObjectEntity({
    //   userId: req.user.id,
    //   objectFile,
    //   requestedPermission: ObjectPermission.READ,
    // });
    // if (!canAccess) {
    //   res.status(403).json({ error: "Forbidden" });
    //   return;
    // }

    const response = await objectStorageService.downloadObject(objectFile);

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
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
