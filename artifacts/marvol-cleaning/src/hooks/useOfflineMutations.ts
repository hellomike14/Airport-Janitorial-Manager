import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOffline } from "@/contexts/OfflineContext";
import { storePhotoBlob } from "@/lib/offlineStore";

interface TaskCacheItem {
  id: number;
  completed: boolean;
  completedAt: string | null;
  completedById: number | null;
  [key: string]: unknown;
}

interface IssueCacheItem {
  id: number;
  resolved: boolean;
  completedAt?: string | null;
  [key: string]: unknown;
}

function updateTasksCache(
  old: unknown,
  taskId: number,
  updates: Partial<TaskCacheItem>
): unknown {
  if (!Array.isArray(old)) return old;
  return (old as TaskCacheItem[]).map((t) =>
    t.id === taskId ? { ...t, ...updates } : t
  );
}

function updateIssuesCache(
  old: unknown,
  issueId: number,
  updates: Partial<IssueCacheItem>
): unknown {
  if (!Array.isArray(old)) return old;
  return (old as IssueCacheItem[]).map((i) =>
    i.id === issueId ? { ...i, ...updates } : i
  );
}

export function useOfflineCompleteTask() {
  const { isOnline, queueMutationIfOffline } = useOffline();
  const qc = useQueryClient();

  const mutate = useCallback(
    async (taskId: number, completedById: number) => {
      if (!isOnline) {
        const queued = await queueMutationIfOffline(
          "POST",
          `/api/tasks/${taskId}/complete`,
          { completedById }
        );
        if (queued) {
          qc.setQueriesData({ queryKey: ["/api/tasks"] }, (old: unknown) =>
            updateTasksCache(old, taskId, {
              completed: true,
              completedAt: new Date().toISOString(),
              completedById,
            })
          );
          return true;
        }
      }
      return false;
    },
    [isOnline, queueMutationIfOffline, qc]
  );

  return { mutateOffline: mutate, isOnline };
}

export function useOfflineUncompleteTask() {
  const { isOnline, queueMutationIfOffline } = useOffline();
  const qc = useQueryClient();

  const mutate = useCallback(
    async (taskId: number) => {
      if (!isOnline) {
        const queued = await queueMutationIfOffline(
          "POST",
          `/api/tasks/${taskId}/uncomplete`
        );
        if (queued) {
          qc.setQueriesData({ queryKey: ["/api/tasks"] }, (old: unknown) =>
            updateTasksCache(old, taskId, {
              completed: false,
              completedAt: null,
              completedById: null,
            })
          );
          return true;
        }
      }
      return false;
    },
    [isOnline, queueMutationIfOffline, qc]
  );

  return { mutateOffline: mutate, isOnline };
}

export function useOfflineCreateIssue() {
  const { isOnline, queueMutationIfOffline } = useOffline();
  const qc = useQueryClient();

  const mutate = useCallback(
    async (
      data: {
        areaId: number;
        description: string;
        severity: string;
        reportedById: number;
        beforeImagePath?: string | null;
      },
      photoFile?: File | null
    ) => {
      if (!isOnline) {
        const photoBlobKeys: string[] = [];

        if (photoFile) {
          const blobKey = `beforeImagePath:issue-${Date.now()}`;
          await storePhotoBlob(blobKey, photoFile, photoFile.name, photoFile.type);
          photoBlobKeys.push(blobKey);
        }

        const queued = await queueMutationIfOffline(
          "POST",
          `/api/issues`,
          data,
          photoBlobKeys.length > 0 ? photoBlobKeys : undefined
        );

        if (queued) {
          qc.setQueriesData({ queryKey: ["/api/issues"] }, (old: unknown) => {
            if (!Array.isArray(old)) return old;
            return [
              ...old,
              {
                id: -Date.now(),
                ...data,
                resolved: false,
                createdAt: new Date().toISOString(),
                _offline: true,
              },
            ];
          });
          return true;
        }
      }
      return false;
    },
    [isOnline, queueMutationIfOffline, qc]
  );

  return { mutateOffline: mutate, isOnline };
}

export function useOfflineResolveIssue() {
  const { isOnline, queueMutationIfOffline } = useOffline();
  const qc = useQueryClient();

  const mutate = useCallback(
    async (issueId: number) => {
      if (!isOnline) {
        const queued = await queueMutationIfOffline(
          "POST",
          `/api/issues/${issueId}/resolve`
        );
        if (queued) {
          qc.setQueriesData({ queryKey: ["/api/issues"] }, (old: unknown) =>
            updateIssuesCache(old, issueId, { resolved: true })
          );
          return true;
        }
      }
      return false;
    },
    [isOnline, queueMutationIfOffline, qc]
  );

  return { mutateOffline: mutate, isOnline };
}

export function useOfflineCompleteIssue() {
  const { isOnline, queueMutationIfOffline } = useOffline();
  const qc = useQueryClient();

  const mutate = useCallback(
    async (
      issueId: number,
      data: { completionNotes?: string | null; completedById: number },
      photoFile?: File | null
    ) => {
      if (!isOnline) {
        const photoBlobKeys: string[] = [];

        if (photoFile) {
          const blobKey = `afterImagePath:issue-complete-${Date.now()}`;
          await storePhotoBlob(blobKey, photoFile, photoFile.name, photoFile.type);
          photoBlobKeys.push(blobKey);
        }

        const queued = await queueMutationIfOffline(
          "POST",
          `/api/issues/${issueId}/complete`,
          data,
          photoBlobKeys.length > 0 ? photoBlobKeys : undefined
        );

        if (queued) {
          qc.setQueriesData({ queryKey: ["/api/issues"] }, (old: unknown) =>
            updateIssuesCache(old, issueId, {
              resolved: true,
              completedAt: new Date().toISOString(),
            })
          );
          return true;
        }
      }
      return false;
    },
    [isOnline, queueMutationIfOffline, qc]
  );

  return { mutateOffline: mutate, isOnline };
}
