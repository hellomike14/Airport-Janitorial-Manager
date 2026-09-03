import React, { createContext, useContext, useEffect, useCallback, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOnlineStatus, type SyncState } from "@/hooks/useOnlineStatus";
import { processQueue, queueMutation } from "@/lib/offlineQueue";
import {
  cacheApiResponse,
  getCachedApiResponse,
  getOfflineDataGeneration,
  getQueueSize,
  registerBeforeOfflinePurge,
} from "@/lib/offlineStore";
import { useHydrateFromOfflineCache, useCacheApiResponses } from "@/hooks/useOfflineCache";

interface OfflineContextValue {
  isOnline: boolean;
  syncState: SyncState;
  pendingCount: number;
  queueMutationIfOffline: (
    method: string,
    endpoint: string,
    payload?: unknown,
    photoBlobKeys?: string[]
  ) => Promise<boolean>;
  cacheResponse: (url: string, data: unknown) => Promise<void>;
  getCachedResponse: (url: string) => Promise<unknown | null>;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

const RETRY_DELAYS = [5000, 15000, 30000, 60000];

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { isOnline, syncState, markSyncing, markSynced, markSyncError } = useOnlineStatus();
  const dataGenerationRef = useRef(getOfflineDataGeneration());
  const dataGeneration = dataGenerationRef.current;
  const [pendingCount, setPendingCount] = useState(0);
  const isActiveRef = useRef(true);
  const isSyncingRef = useRef(false);
  const syncAbortRef = useRef<AbortController | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useHydrateFromOfflineCache(dataGeneration);
  useCacheApiResponses(dataGeneration);

  const refreshPendingCount = useCallback(async () => {
    const count = await getQueueSize();
    if (isActiveRef.current) setPendingCount(count);
  }, []);

  const cancelSync = useCallback(() => {
    syncAbortRef.current?.abort();
    syncAbortRef.current = null;
    isSyncingRef.current = false;
  }, []);

  const syncQueue = useCallback(async () => {
    if (isSyncingRef.current || !navigator.onLine) return;

    const controller = new AbortController();
    isSyncingRef.current = true;
    syncAbortRef.current = controller;

    try {
      const count = await getQueueSize();
      if (controller.signal.aborted) return;
      if (count === 0) {
        retryCountRef.current = 0;
        markSynced();
        return;
      }

      markSyncing();
      const result = await processQueue(undefined, controller.signal);
      if (controller.signal.aborted) return;

      await refreshPendingCount();
      if (controller.signal.aborted) return;

      if (result.failed > 0) {
        markSyncError();
        const delay = RETRY_DELAYS[Math.min(retryCountRef.current, RETRY_DELAYS.length - 1)];
        retryCountRef.current++;
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          syncQueue();
        }, delay);
      } else {
        retryCountRef.current = 0;
        markSynced();
        queryClient.invalidateQueries();
      }
    } catch (error) {
      if (controller.signal.aborted) return;

      console.warn("[OfflineQueue] Failed to synchronize queued actions:", error);
      markSyncError();
      const delay = RETRY_DELAYS[Math.min(retryCountRef.current, RETRY_DELAYS.length - 1)];
      retryCountRef.current++;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        syncQueue();
      }, delay);
    } finally {
      if (syncAbortRef.current === controller) {
        syncAbortRef.current = null;
        isSyncingRef.current = false;
      }
    }
  }, [queryClient, markSyncing, markSynced, markSyncError, refreshPendingCount]);

  useEffect(() => {
    if (isOnline) {
      retryCountRef.current = 0;
      syncQueue();
    } else {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      cancelSync();
    }
  }, [cancelSync, isOnline, syncQueue]);

  useEffect(() => {
    isActiveRef.current = true;
    const unregisterBeforePurge = registerBeforeOfflinePurge(() => {
      isActiveRef.current = false;
      cancelSync();
    });

    refreshPendingCount();
    return () => {
      isActiveRef.current = false;
      unregisterBeforePurge();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      cancelSync();
    };
  }, [cancelSync, refreshPendingCount]);

  const queueMutationIfOffline = useCallback(
    async (
      method: string,
      endpoint: string,
      payload?: unknown,
      photoBlobKeys?: string[]
    ): Promise<boolean> => {
      if (isOnline || !isActiveRef.current) return false;

      await queueMutation(
        method,
        endpoint,
        payload,
        photoBlobKeys,
        dataGeneration,
      );
      if (!isActiveRef.current) return false;

      await refreshPendingCount();
      return true;
    },
    [dataGeneration, isOnline, refreshPendingCount]
  );

  const cacheResponse = useCallback(async (url: string, data: unknown) => {
    if (!isActiveRef.current) return;
    await cacheApiResponse(url, data, dataGeneration);
  }, [dataGeneration]);

  const getCachedResponse = useCallback(async (url: string) => {
    return getCachedApiResponse(url);
  }, []);

  return (
    <OfflineContext.Provider
      value={{
        isOnline,
        syncState,
        pendingCount,
        queueMutationIfOffline,
        cacheResponse,
        getCachedResponse,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
}

export function useOffline() {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error("useOffline must be used inside OfflineProvider");
  return ctx;
}
