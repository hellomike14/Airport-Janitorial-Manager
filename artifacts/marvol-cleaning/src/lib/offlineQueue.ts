import {
  enqueueAction,
  getQueuedActions,
  removeQueuedAction,
  getPhotoBlob,
  removePhotoBlob,
  type QueuedAction,
  type QueuedPhotoUpload,
} from "./offlineStore";
import { requestUploadUrl, type UploadUrlRequest } from "@workspace/api-client-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export type ActionResult = "success" | "retry" | "discard";

async function uploadPhotoBlob(upload: QueuedPhotoUpload): Promise<string | null> {
  const photoData = await getPhotoBlob(upload.blobKey);
  if (!photoData) return null;

  const file = new File([photoData.blob], photoData.fileName, {
    type: photoData.contentType,
  });

  const { uploadURL, objectPath } = await requestUploadUrl({
    ...upload.request,
    name: file.name,
    size: file.size,
    contentType: file.type,
  });

  const putRes = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });

  if (!putRes.ok) throw new Error("Failed to upload photo");

  return objectPath;
}

async function cleanupPhotoBlobsForAction(action: QueuedAction): Promise<void> {
  if (action.photoBlobKeys) {
    for (const blobKey of action.photoBlobKeys) {
      await removePhotoBlob(blobKey).catch(() => {});
    }
  }
  if (action.photoUploads) {
    for (const upload of action.photoUploads) {
      await removePhotoBlob(upload.blobKey).catch(() => {});
    }
  }
}

function legacyPhotoUploads(action: QueuedAction): QueuedPhotoUpload[] {
  return (action.photoBlobKeys ?? []).flatMap((blobKey) => {
    const field = blobKey.split(":")[0];
    const taskMatch = action.endpoint.match(/^\/api\/tasks\/(\d+)\/images$/);
    if (taskMatch && (field === "beforeImagePath" || field === "afterImagePath")) {
      const request: UploadUrlRequest = {
        name: blobKey,
        size: 1,
        contentType: "image/jpeg",
        purpose: field === "beforeImagePath" ? "task_before" : "task_after",
        taskId: Number(taskMatch[1]),
      };
      return [{ blobKey, request }];
    }
    const issueMatch = action.endpoint.match(/^\/api\/issues\/(\d+)\/complete$/);
    if (issueMatch && field === "afterImagePath") {
      return [{
        blobKey,
        request: { name: blobKey, size: 1, contentType: "image/jpeg", purpose: "issue_after", issueId: Number(issueMatch[1]) },
      }];
    }
    if (action.endpoint === "/api/issues" && field === "beforeImagePath") {
      const areaId = (action.payload as { areaId?: unknown } | undefined)?.areaId;
      if (typeof areaId === "number") {
        return [{
          blobKey,
          request: { name: blobKey, size: 1, contentType: "image/jpeg", purpose: "issue_before", areaId },
        }];
      }
    }
    return [];
  });
}

async function executeAction(action: QueuedAction): Promise<ActionResult> {
  try {
    let payload = action.payload as Record<string, unknown> | undefined;

    const photoUploads = action.photoUploads ?? legacyPhotoUploads(action);
    if (photoUploads.length > 0) {
      payload = { ...payload };
      for (const upload of photoUploads) {
        const parts = upload.blobKey.split(":");
        const fieldName = parts[0];
        const objectPath = await uploadPhotoBlob(upload);
        if (objectPath && payload) {
          payload[fieldName] = objectPath;
        }
      }
    }

    const fetchOptions: RequestInit = {
      method: action.method,
      headers: { "Content-Type": "application/json" },
    };

    if (payload && action.method !== "GET") {
      fetchOptions.body = JSON.stringify(payload);
    }

    const url = action.endpoint.startsWith("http")
      ? action.endpoint
      : `${BASE_URL}${action.endpoint}`;

    const res = await fetch(url, fetchOptions);

    if (res.ok) return "success";

    if (res.status === 401 || res.status === 403) {
      return "retry";
    }

    if (res.status === 404 || res.status === 410) {
      return "discard";
    }

    if (res.status >= 500 || res.status === 408 || res.status === 429) {
      return "retry";
    }

    if (res.status === 409) {
      return "discard";
    }

    return "discard";
  } catch (err) {
    console.warn("[OfflineQueue] Network error executing action:", err);
    return "retry";
  }
}

export type SyncProgressCallback = (processed: number, total: number) => void;

export async function processQueue(
  onProgress?: SyncProgressCallback
): Promise<{ processed: number; failed: number; discarded: number; total: number }> {
  const actions = await getQueuedActions();
  const total = actions.length;
  let processed = 0;
  let failed = 0;
  let discarded = 0;

  for (const action of actions) {
    const result = await executeAction(action);
    if (result === "success" || result === "discard") {
      await cleanupPhotoBlobsForAction(action);
      await removeQueuedAction(action.id!);
      if (result === "success") processed++;
      else discarded++;
    } else {
      failed++;
    }
    onProgress?.(processed + failed + discarded, total);
  }

  return { processed, failed, discarded, total };
}

export async function queueMutation(
  method: string,
  endpoint: string,
  payload?: unknown,
  photoUploads?: QueuedPhotoUpload[]
): Promise<number> {
  return enqueueAction({ method, endpoint, payload, photoUploads });
}

export { getQueuedActions, getQueueSize } from "./offlineStore";
