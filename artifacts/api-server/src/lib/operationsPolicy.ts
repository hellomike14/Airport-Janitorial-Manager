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

export function isCurrentEmployee(employee: {
  active?: unknown;
  formerEmployee?: unknown;
}): boolean {
  return employee.active === true && employee.formerEmployee === false;
}

export function orlandoDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
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
