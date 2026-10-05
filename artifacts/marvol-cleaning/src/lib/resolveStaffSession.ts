export type StaffIdentity = { id: number; name: string; role: "admin" | "supervisor" | "staff" | "inspector" };
export type StaffResolution =
  | { status: "ok"; user: StaffIdentity }
  | { status: "nomatch" | "expired" | "disabled" | "error"; diagnosticId?: string }
  | { status: "unavailable"; diagnosticId?: string; reason?: "timeout" };

export function isStaffIdentity(value: unknown): value is StaffIdentity {
  if (!value || typeof value !== "object") return false;
  const person = value as Record<string, unknown>;
  return Number.isInteger(person.id) && Number(person.id) > 0 && typeof person.name === "string" &&
    ["admin", "supervisor", "staff", "inspector"].includes(String(person.role));
}

type ErrorPayload = { error?: unknown; diagnosticId?: unknown };

async function readError(response: Response): Promise<ErrorPayload> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === "object" ? body as ErrorPayload : {};
  } catch {
    return {};
  }
}

function failure(status: "nomatch" | "expired" | "disabled" | "unavailable" | "error", diagnosticId?: string): StaffResolution {
  return diagnosticId ? { status, diagnosticId } : { status };
}

/** One bounded, cookie-authenticated attempt covers headers and body parsing. */
export async function resolveStaffSession({ url, signal, timeoutMs = 12000, fetcher = fetch }: {
  url: string; signal: AbortSignal; timeoutMs?: number; fetcher?: typeof fetch;
}): Promise<StaffResolution> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let abortListener: () => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    abortListener = () => { controller.abort(); reject(new Error("Sign-in cancelled")); };
    signal.addEventListener("abort", abortListener, { once: true });
    if (signal.aborted) abortListener();
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error("Staff lookup timed out"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([stopped, (async (): Promise<StaffResolution> => {
      const response = await fetcher(url, {
        credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const payload = await readError(response);
        const diagnosticId = typeof payload.diagnosticId === "string" ? payload.diagnosticId : undefined;
        if (response.status === 401 && payload.error === "SESSION_EXPIRED") return failure("expired", diagnosticId);
        if (response.status === 404 && payload.error === "NO_STAFF_MATCH") return failure("nomatch", diagnosticId);
        if (response.status === 403 && payload.error === "STAFF_ACCESS_DISABLED") return failure("disabled", diagnosticId);
        if (response.status === 503 && payload.error === "AUTH_SERVICE_UNAVAILABLE") return failure("unavailable", diagnosticId);
        return failure("error", diagnosticId);
      }
      const user: unknown = await response.json();
      return isStaffIdentity(user) ? { status: "ok", user } : { status: "error" };
    })()]);
  } catch {
    return timedOut ? { status: "unavailable", reason: "timeout" } : { status: "error" };
  }
  finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abortListener);
  }
}
