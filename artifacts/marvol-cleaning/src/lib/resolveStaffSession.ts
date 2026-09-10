export type StaffIdentity = { id: number; name: string; role: "admin" | "supervisor" | "staff" | "inspector" };
export type StaffResolution =
  | { status: "ok"; user: StaffIdentity }
  | { status: "nomatch" | "expired" | "error" };

export function isStaffIdentity(value: unknown): value is StaffIdentity {
  if (!value || typeof value !== "object") return false;
  const person = value as Record<string, unknown>;
  return Number.isInteger(person.id) && Number(person.id) > 0 && typeof person.name === "string" &&
    ["admin", "supervisor", "staff", "inspector"].includes(String(person.role));
}

/** One bounded attempt covers token acquisition, response headers, and body parsing. */
export async function resolveStaffSession({ url, getToken, signal, timeoutMs = 12000, fetcher = fetch }: {
  url: string; getToken: (fresh?: boolean) => Promise<string | null>; signal: AbortSignal;
  timeoutMs?: number; fetcher?: typeof fetch;
}): Promise<StaffResolution> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: () => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    abortListener = () => { controller.abort(); reject(new Error("Sign-in cancelled")); };
    signal.addEventListener("abort", abortListener, { once: true });
    if (signal.aborted) abortListener();
    timer = setTimeout(abortListener, timeoutMs);
  });
  try {
    return await Promise.race([stopped, (async (): Promise<StaffResolution> => {
      const token = await getToken();
      if (controller.signal.aborted) return { status: "error" };
      if (!token) return { status: "expired" };
      const request = (sessionToken: string) => fetcher(url, {
        credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { Authorization: `Bearer ${sessionToken}`, Accept: "application/json" },
      });
      let response = await request(token);
      if (response.status === 401) {
        const refreshed = await getToken(true);
        if (controller.signal.aborted) return { status: "error" };
        if (refreshed) response = await request(refreshed);
      }
      if (response.status === 401) return { status: "expired" };
      if (response.status === 404) return { status: "nomatch" };
      if (!response.ok) return { status: "error" };
      const user: unknown = await response.json();
      return isStaffIdentity(user) ? { status: "ok", user } : { status: "error" };
    })()]);
  } catch { return { status: "error" }; }
  finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abortListener);
  }
}
