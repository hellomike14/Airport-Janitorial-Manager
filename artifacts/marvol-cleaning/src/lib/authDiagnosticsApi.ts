export type AuthDiagnosticCode = "AUTH_SERVICE_UNAVAILABLE" | "STAFF_LOOKUP_TIMEOUT";

export type AuthDiagnosticEvent = {
  diagnosticId: string;
  code: string;
  source: "server" | "client";
  createdAt: string;
};

export type AccessState = {
  active: boolean;
  loginEnabled: boolean;
  formerEmployee: boolean;
  hasEmail: boolean;
};

export type AccessChange = {
  id: number | string;
  actorName: string;
  staffName: string;
  action: string;
  createdAt: string;
  before: AccessState;
  after: AccessState;
};

export type AuthDiagnostics = {
  events: AuthDiagnosticEvent[];
  summary: Array<{ code: string; count: number }>;
  accessChanges: AccessChange[];
};

const BASE = import.meta.env.BASE_URL;

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export async function reportAuthDiagnostic(code: AuthDiagnosticCode): Promise<string | undefined> {
  const response = await fetch(`${BASE}api/auth-diagnostics/events`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ code }),
  });
  const result = await parseJson<{ diagnosticId?: unknown }>(response);
  return typeof result.diagnosticId === "string" ? result.diagnosticId : undefined;
}

export async function getAuthDiagnostics(signal?: AbortSignal): Promise<AuthDiagnostics> {
  const response = await fetch(`${BASE}api/auth-diagnostics`, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  return parseJson<AuthDiagnostics>(response);
}