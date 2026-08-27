export type IncidentStatus =
  | "NEW"
  | "ACKNOWLEDGED"
  | "IN_PROGRESS"
  | "OVERDUE"
  | "RESOLVED"
  | "ARCHIVED";

export interface SupervisorChoice {
  name: string;
  email: string;
  schedule: "weekday" | "weekend";
}

export interface SupervisorRoutingConfig {
  timezone: string;
  weekdayName: string;
  weekdayEmail: string;
  weekendName: string;
  weekendEmail: string;
}

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&#39;": "'",
  "&nbsp;": " ",
};

export function stripHtml(input: string): string {
  if (!input) return "";

  return input
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/gi, (entity) => ENTITY_MAP[entity.toLowerCase()] ?? entity)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function detectLocation(text: string): string | null {
  const patterns = [
    /\bterminal\s+[A-Z0-9][A-Z0-9-]*\b/gi,
    /\bconcourse\s+[A-Z0-9][A-Z0-9-]*\b/gi,
    /\bgate\s+[A-Z0-9][A-Z0-9-]*\b/gi,
    /\bcheckpoint\s+[A-Z0-9][A-Z0-9-]*\b/gi,
    /\blevel\s+(?:[A-Z0-9-]+|one|two|three|four|five)\b/gi,
    /\bbaggage\s+claim(?:\s+(?:area\s+)?[A-Z0-9-]+)?\b/gi,
    /\b(?:men'?s|women'?s|family|public)?\s*restroom(?:\s+(?:near|by|at)\s+[^.,;\n]+)?/gi,
    /\b(?:arrival|departure)s?\s+(?:level|hall|area)\b/gi,
  ];

  const found: string[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const cleaned = match[0].replace(/\s+/g, " ").trim();
      if (cleaned && !found.some((item) => item.toLowerCase() === cleaned.toLowerCase())) {
        found.push(cleaned);
      }
    }
  }

  return found.length ? found.slice(0, 4).join(" · ") : null;
}

export function chooseSupervisor(
  when: Date,
  routing: SupervisorRoutingConfig,
): SupervisorChoice {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: routing.timezone,
    weekday: "short",
  }).format(when);

  const isWeekend = weekday === "Sat" || weekday === "Sun";
  return isWeekend
    ? {
        name: routing.weekendName,
        email: normalizeEmail(routing.weekendEmail),
        schedule: "weekend",
      }
    : {
        name: routing.weekdayName,
        email: normalizeEmail(routing.weekdayEmail),
        schedule: "weekday",
      };
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function isOpenStatus(status: IncidentStatus): boolean {
  return !["RESOLVED", "ARCHIVED"].includes(status);
}

export function firstNonEmpty(...values: Array<string | null | undefined>): string {
  return values.find((value) => Boolean(value?.trim()))?.trim() ?? "";
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
