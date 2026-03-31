import { openDB, type DBSchema, type IDBPDatabase } from "idb";

interface OfflineDB extends DBSchema {
  apiCache: {
    key: string;
    value: {
      url: string;
      data: unknown;
      timestamp: number;
    };
  };
  offlineQueue: {
    key: number;
    value: {
      id?: number;
      method: string;
      endpoint: string;
      payload?: unknown;
      photoBlobKeys?: string[];
      createdAt: number;
    };
    indexes: { "by-created": number };
  };
  photoBlobs: {
    key: string;
    value: {
      key: string;
      blob: Blob;
      fileName: string;
      contentType: string;
    };
  };
}

const DB_NAME = "marvol-offline";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

function getDB(): Promise<IDBPDatabase<OfflineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("apiCache")) {
          db.createObjectStore("apiCache", { keyPath: "url" });
        }
        if (!db.objectStoreNames.contains("offlineQueue")) {
          const store = db.createObjectStore("offlineQueue", {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("by-created", "createdAt");
        }
        if (!db.objectStoreNames.contains("photoBlobs")) {
          db.createObjectStore("photoBlobs", { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}

export async function cacheApiResponse(url: string, data: unknown): Promise<void> {
  const db = await getDB();
  await db.put("apiCache", { url, data, timestamp: Date.now() });
}

export async function getCachedApiResponse(url: string): Promise<unknown | null> {
  const db = await getDB();
  const entry = await db.get("apiCache", url);
  return entry?.data ?? null;
}

export async function getAllCachedResponses(): Promise<
  Array<{ url: string; data: unknown; timestamp: number }>
> {
  const db = await getDB();
  return db.getAll("apiCache");
}

export async function clearApiCache(): Promise<void> {
  const db = await getDB();
  await db.clear("apiCache");
}

export interface QueuedAction {
  id?: number;
  method: string;
  endpoint: string;
  payload?: unknown;
  photoBlobKeys?: string[];
  createdAt: number;
}

export async function enqueueAction(action: Omit<QueuedAction, "id" | "createdAt">): Promise<number> {
  const db = await getDB();
  const id = await db.add("offlineQueue", {
    ...action,
    createdAt: Date.now(),
  } as QueuedAction);
  return id as number;
}

export async function getQueuedActions(): Promise<QueuedAction[]> {
  const db = await getDB();
  return db.getAllFromIndex("offlineQueue", "by-created");
}

export async function removeQueuedAction(id: number): Promise<void> {
  const db = await getDB();
  await db.delete("offlineQueue", id);
}

export async function getQueueSize(): Promise<number> {
  const db = await getDB();
  return db.count("offlineQueue");
}

export async function storePhotoBlob(
  key: string,
  blob: Blob,
  fileName: string,
  contentType: string
): Promise<void> {
  const db = await getDB();
  await db.put("photoBlobs", { key, blob, fileName, contentType });
}

export async function getPhotoBlob(
  key: string
): Promise<{ blob: Blob; fileName: string; contentType: string } | null> {
  const db = await getDB();
  const entry = await db.get("photoBlobs", key);
  return entry ? { blob: entry.blob, fileName: entry.fileName, contentType: entry.contentType } : null;
}

export async function removePhotoBlob(key: string): Promise<void> {
  const db = await getDB();
  await db.delete("photoBlobs", key);
}
