import {
  enqueueAction,
  getQueuedActions,
  removeQueuedAction,
  getPhotoBlob,
  removePhotoBlob,
  type QueuedAction,
} from "./offlineStore";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export type ActionResult = "success" | "retry" | "discard";

async function uploadPhotoBlob(
  blobKey: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const photoData = await getPhotoBlob(blobKey);
  if (signal?.aborted) return null;
  if (!photoData) return null;

  const file = new File([photoData.blob], photoData.fileName, {
    type: photoData.contentType,
  });

  const presignRes = await fetch(`${BASE_URL}/api/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      contentType: file.type,
      purpose: "staff-photo",
    }),
    signal,
  });

  if (!presignRes.ok) throw new Error("Failed to get presigned URL");

  const { uploadURL, objectPath } = await presignRes.json();

  const putRes = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
    signal,
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
}

async function executeAction(
  action: QueuedAction,
  signal?: AbortSignal,
): Promise<ActionResult> {
  try {
    if (signal?.aborted) return "retry";

    let payload = action.payload as Record<string, unknown> | undefined;

    if (action.photoBlobKeys && action.photoBlobKeys.length > 0) {
      payload = { ...payload };
      for (const blobKey of action.photoBlobKeys) {
        if (signal?.aborted) return "retry";
        const parts = blobKey.split(":");
        const fieldName = parts[0];
        const objectPath = await uploadPhotoBlob(blobKey, signal);
        if (signal?.aborted) return "retry";
        if (objectPath && payload) {
          payload[fieldName] = objectPath;
        }
      }
    }

    const fetchOptions: RequestInit = {
      method: action.method,
      headers: { "Content-Type": "application/json" },
      signal,
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
    if (signal?.aborted) return "retry";
    console.warn("[OfflineQueue] Network error executing action:", err);
    return "retry";
  }
}

export type SyncProgressCallback = (processed: number, total: number) => void;

export async function processQueue(
  onProgress?: SyncProgressCallback,
  signal?: AbortSignal,
): Promise<{ processed: number; failed: number; discarded: number; total: number }> {
  const actions = await getQueuedActions();
  const total = actions.length;
  let processed = 0;
  let failed = 0;
  let discarded = 0;

  for (const action of actions) {
    if (signal?.aborted) break;

    const result = await executeAction(action, signal);
    // Account changes abort the old provider before the new identity is
    // reconciled. Do not continue, clean up, or dequeue under a new session.
    if (signal?.aborted) break;

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
  photoBlobKeys?: string[],
  dataGeneration?: number,
): Promise<number> {
  return enqueueAction(
    { method, endpoint, payload, photoBlobKeys },
    dataGeneration,
  );
}

export { getQueuedActions, getQueueSize } from "./offlineStore";
