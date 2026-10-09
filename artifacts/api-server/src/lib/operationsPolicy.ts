export const INSPECTION_CHECKS = [
  "Floors free of litter",
  "Corners and edges swept",
  "Trash bins emptied",
  "Bin liners replaced",
  "Stair steps clean",
  "Stair landings clean",
  "Handrails sanitized",
  "Elevator floors clean",
  "Elevator buttons sanitized",
  "Elevator tracks clear",
  "Doors and glass clean",
  "Signs and pillars clean",
  "Drain grates clear",
  "Spills addressed or reported",
  "Walkways clear and safe",
] as const;

const ORLANDO_TIME_ZONE = "America/New_York";

export function isCurrentEmployee(employee: {
  active?: unknown;
  formerEmployee?: unknown;
  role?: unknown;
}): boolean {
  return employee.active === true &&
    employee.formerEmployee === false &&
    (employee.role === "staff" ||
      employee.role === "supervisor" ||
      employee.role === "admin");
}

export function isEligibleOperationsEmployee(employee: {
  active?: unknown;
  formerEmployee?: unknown;
  role?: unknown;
}): boolean {
  return employee.active === true &&
    employee.formerEmployee !== true &&
    (employee.role === "staff" ||
      employee.role === "supervisor" ||
      employee.role === "admin");
}

export function eligibleOperationsStaff<
  T extends {
    active?: unknown;
    formerEmployee?: unknown;
    role?: unknown;
  },
>(staff: readonly T[]): T[] {
  return staff.filter(isEligibleOperationsEmployee);
}

export function orlandoDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ORLANDO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Convert an Orlando calendar date's local midnight into its exact UTC instant. */
export function orlandoStartOfDay(dateKey: string): Date {
  if (!validDate(dateKey)) throw new RangeError("Expected a valid Orlando calendar date");
  const [year, month, day] = dateKey.split("-").map(Number);
  const targetWallTime = new Date(0);
  targetWallTime.setUTCFullYear(year!, month! - 1, day!);
  targetWallTime.setUTCHours(0, 0, 0, 0);

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ORLANDO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let instant = targetWallTime.getTime();
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = formatter.formatToParts(new Date(instant));
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)!.value);
    const representedWallTime = new Date(0);
    representedWallTime.setUTCFullYear(value("year"), value("month") - 1, value("day"));
    representedWallTime.setUTCHours(value("hour"), value("minute"), value("second"), 0);
    const correction = targetWallTime.getTime() - representedWallTime.getTime();
    if (correction === 0) return new Date(instant);
    instant += correction;
  }
  throw new RangeError(`Could not resolve Orlando midnight for ${dateKey}`);
}

/** Start of the next Orlando calendar day, including 23- and 25-hour DST days. */
export function orlandoStartOfNextDay(dateKey: string): Date {
  if (!validDate(dateKey)) throw new RangeError("Expected a valid Orlando calendar date");
  const nextDate = new Date(`${dateKey}T12:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return orlandoStartOfDay(nextDate.toISOString().slice(0, 10));
}

export function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Month must be YYYY-MM");
  const from = `${month}-01`;
  const start = new Date(`${from}T00:00:00Z`);
  const to = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
  )
    .toISOString()
    .slice(0, 10);
  return { from, to };
}
export function previousMonth(now = new Date()) {
  const local = orlandoDate(now);
  const date = new Date(`${local.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}
export function paidMinutes(entry: {
  clockIn: Date;
  clockOut: Date | null;
  breakMinutes: number;
}) {
  if (!entry.clockOut) return 0;
  return Math.max(
    0,
    Math.floor((entry.clockOut.getTime() - entry.clockIn.getTime()) / 60000) -
      entry.breakMinutes,
  );
}
export function distanceMeters(
  lat: number,
  lng: number,
  siteLat: number,
  siteLng: number,
) {
  const rad = (n: number) => (n * Math.PI) / 180;
  const a =
    Math.sin(rad(lat - siteLat) / 2) ** 2 +
    Math.cos(rad(lat)) *
      Math.cos(rad(siteLat)) *
      Math.sin(rad(lng - siteLng) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}
export function gpsProblem(
  location: { latitude: number; longitude: number; accuracy: number },
  settings: {
    siteLatitude: number;
    siteLongitude: number;
    radiusMeters: number;
    maxAccuracyMeters: number;
    gpsRequired: boolean;
  },
) {
  if (!settings.gpsRequired) return null;
  if (location.accuracy > settings.maxAccuracyMeters)
    return "GPS accuracy is too low. Move outdoors and try again.";
  if (
    distanceMeters(
      location.latitude,
      location.longitude,
      settings.siteLatitude,
      settings.siteLongitude,
    ) > settings.radiusMeters
  )
    return "You must be within the configured MCO worksite to clock in.";
  return null;
}
export function inspectionScore(checks: boolean[]) {
  if (checks.length !== 15)
    throw new Error("All 15 inspection checks are required");
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
export function csvCell(value: string | number) {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function overlaps(
  a: { startTime: string; endTime: string },
  b: { startTime: string; endTime: string },
) {
  return a.startTime < b.endTime && b.startTime < a.endTime;
}
