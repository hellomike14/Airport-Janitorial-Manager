import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cacheApiResponse, getAllCachedResponses } from "@/lib/offlineStore";

const CACHE_KEY_PREFIXES = [
  "/api/tasks",
  "/api/assignments",
  "/api/areas",
  "/api/issues",
];

function serializeQueryKey(queryKey: unknown[]): string {
  return JSON.stringify(queryKey);
}

function matchesCachePrefix(keyStr: string): boolean {
  return CACHE_KEY_PREFIXES.some((prefix) => keyStr.includes(prefix));
}

export function useHydrateFromOfflineCache() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let mounted = true;

    async function hydrate() {
      try {
        const cached = await getAllCachedResponses();
        if (!mounted) return;

        for (const entry of cached) {
          if (entry.data != null) {
            try {
              const queryKey = JSON.parse(entry.url);
              const existing = queryClient.getQueryData(queryKey);
              if (!existing) {
                queryClient.setQueryData(queryKey, entry.data);
              }
            } catch {
              continue;
            }
          }
        }
      } catch (err) {
        console.warn("[OfflineCache] Failed to hydrate from IndexedDB:", err);
      }
    }

    hydrate();

    return () => {
      mounted = false;
    };
  }, [queryClient]);
}

export function useCacheApiResponses() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "success") {
        const queryKey = event.query.queryKey;
        const serialized = serializeQueryKey(queryKey);

        if (matchesCachePrefix(serialized)) {
          const data = event.query.state.data;
          if (data != null) {
            cacheApiResponse(serialized, data).catch(() => {});
          }
        }
      }
    });

    return unsubscribe;
  }, [queryClient]);
}
