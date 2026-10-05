export const BOOTSTRAP_SLOW_MS = 15_000;
export const BOOTSTRAP_RETRY_MS = 30_000;
const RETRY_KEY = "marvol:auth-bootstrap-retry";

type RetryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// Persist before navigating: a failed second load must not cause a reload loop.
// If storage is unavailable, only an explicit user retry is safe.
export function claimBootstrapRetry(storage: RetryStorage): boolean {
  try {
    if (storage.getItem(RETRY_KEY) !== null) return false;
    storage.setItem(RETRY_KEY, "used");
    return storage.getItem(RETRY_KEY) === "used";
  } catch {
    return false;
  }
}

export function clearBootstrapRetry(storage: RetryStorage): void {
  try {
    storage.removeItem(RETRY_KEY);
  } catch {
    // Recovery never requires clearing cookies, caches, or offline work.
  }
}