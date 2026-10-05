import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { authDiagnosticEventsTable } from "@workspace/db/schema";

export const SERVER_DIAGNOSTIC_CODES = [
  "SESSION_EXPIRED",
  "NO_STAFF_MATCH",
  "STAFF_ACCESS_DISABLED",
  "AUTH_SERVICE_UNAVAILABLE",
] as const;

export const CLIENT_DIAGNOSTIC_CODES = [
  "AUTH_SERVICE_UNAVAILABLE",
  "STAFF_LOOKUP_TIMEOUT",
] as const;

export type ServerDiagnosticCode = typeof SERVER_DIAGNOSTIC_CODES[number];
export type ClientDiagnosticCode = typeof CLIENT_DIAGNOSTIC_CODES[number];

const serverCodes = new Set<string>(SERVER_DIAGNOSTIC_CODES);
const clientCodes = new Set<string>(CLIENT_DIAGNOSTIC_CODES);

export function isServerDiagnosticCode(value: unknown): value is ServerDiagnosticCode {
  return typeof value === "string" && serverCodes.has(value);
}

export function isClientDiagnosticCode(value: unknown): value is ClientDiagnosticCode {
  return typeof value === "string" && clientCodes.has(value);
}

export function newDiagnosticId(): string {
  return randomUUID();
}

/** Persistence is intentionally best-effort so diagnostics cannot hide the original auth failure. */
export async function recordDiagnostic(
  code: ServerDiagnosticCode | ClientDiagnosticCode,
  source: "server" | "client",
  diagnosticId = newDiagnosticId(),
): Promise<string> {
  const allowed = source === "server" ? isServerDiagnosticCode(code) : isClientDiagnosticCode(code);
  if (!allowed) throw new Error("Diagnostic code is not allowlisted");
  await db.insert(authDiagnosticEventsTable).values({ diagnosticId, code, source });
  return diagnosticId;
}

export async function safeRecordServerDiagnostic(code: ServerDiagnosticCode): Promise<string> {
  const diagnosticId = newDiagnosticId();
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        recordDiagnostic(code, "server", diagnosticId),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("diagnostic persistence deadline")), 1_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Never log raw database/provider errors or replace the auth response.
    console.error("Unable to persist authentication diagnostic");
  }
  return diagnosticId;
}

export type AccessSnapshot = {
  active: boolean;
  loginEnabled: boolean;
  formerEmployee: boolean;
  hasEmail: boolean;
};

export function accessSnapshot(staff: {
  active: boolean;
  loginEnabled: boolean;
  formerEmployee: boolean;
  email: string | null;
}): AccessSnapshot {
  return {
    active: staff.active,
    loginEnabled: staff.loginEnabled,
    formerEmployee: staff.formerEmployee,
    hasEmail: Boolean(staff.email?.trim()),
  };
}

export function accessChangeValues(input: {
  actor: { id: number; name: string };
  staff: { id: number; name: string };
  action: "CREATE" | "UPDATE" | "DELETE";
  before: AccessSnapshot;
  after: AccessSnapshot;
}) {
  return {
    actorStaffId: input.actor.id,
    actorName: input.actor.name,
    staffId: input.staff.id,
    staffName: input.staff.name,
    action: input.action,
    beforeActive: input.before.active,
    beforeLoginEnabled: input.before.loginEnabled,
    beforeFormerEmployee: input.before.formerEmployee,
    beforeHasEmail: input.before.hasEmail,
    afterActive: input.after.active,
    afterLoginEnabled: input.after.loginEnabled,
    afterFormerEmployee: input.after.formerEmployee,
    afterHasEmail: input.after.hasEmail,
  };
}

export class FixedWindowRateLimiter {
  private startedAt = 0;
  private used = 0;

  constructor(
    private readonly maximum: number,
    private readonly windowMilliseconds: number,
  ) {}

  take(now = Date.now()): boolean {
    if (this.startedAt === 0 || now - this.startedAt >= this.windowMilliseconds) {
      this.startedAt = now;
      this.used = 0;
    }
    if (this.used >= this.maximum) return false;
    this.used += 1;
    return true;
  }
}