import React, { createContext, useContext, useEffect, useCallback, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOnlineStatus, type SyncState } from "@/hooks/useOnlineStatus";
import { processQueue } from "@/lib/offlineQueue";
import { cacheApiResponse, getCachedApiResponse, getQueueSize } from "@/lib/offlineStore";
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
  const [pendingCount, setPendingCount] = useState(0);
  const isSyncingRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useHydrateFromOfflineCache();
  useCacheApiResponses();

  const refreshPendingCount = useCallback(async () => {
    const count = await getQueueSize();
    setPendingCount(count);
  }, []);

  const syncQueue = useCallback(async () => {
    if (isSyncingRef.current || !navigator.onLine) return;
    const count = await getQueueSize();
    if (count === 0) {
      retryCountRef.current = 0;
      return;
    }

    isSyncingRef.current = true;
    markSyncing();

    try {
      const result = await processQueue();
      await refreshPendingCount();

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
    } catch {
      markSyncError();
      const delay = RETRY_DELAYS[Math.min(retryCountRef.current, RETRY_DELAYS.length - 1)];
      retryCountRef.current++;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        syncQueue();
      }, delay);
    } finally {
      isSyncingRef.current = false;
    }
  }, [queryClient, markSyncing, markSynced, markSyncError, refreshPendingCount]);

  useEffect(() => {
    if (isOnline) {
      retryCountRef.current = 0;
      syncQueue();
    } else {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    }
  }, [isOnline, syncQueue]);

  useEffect(() => {
    refreshPendingCount();
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [refreshPendingCount]);

  const queueMutationIfOffline = useCallback(
    async (
      method: string,
      endpoint: string,
      payload?: unknown,
      photoBlobKeys?: string[]
    ): Promise<boolean> => {
      if (isOnline) return false;

      const { queueMutation } = await import("@/lib/offlineQueue");
      await queueMutation(method, endpoint, payload, photoBlobKeys);
      await refreshPendingCount();
      return true;
    },
    [isOnline, refreshPendingCount]
  );

  const cacheResponse = useCallback(async (url: string, data: unknown) => {
    await cacheApiResponse(url, data);
  }, []);

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
