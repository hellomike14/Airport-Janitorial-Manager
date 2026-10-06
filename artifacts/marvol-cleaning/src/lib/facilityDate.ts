const FACILITY_TIME_ZONE = "America/New_York";

/** Calendar day at the facility, regardless of the viewer's device time zone. */
export function facilityDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: FACILITY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** A date-only value is a calendar day, not a UTC timestamp. */
export function calendarDate(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00`);
}