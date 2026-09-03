export type InspectorAreaCandidate = {
  id: number;
  name: string;
  terminal: string;
};

export type InspectorAreaMatch =
  | { status: "matched"; areaId: number; matchedBy: "explicit_label" | "exact_line" }
  | { status: "ambiguous"; areaIds: number[] }
  | { status: "missing" };

export type TargetCoordinates = { latitude: number; longitude: number };

export type StaffAssignmentCandidate = {
  staffId: number;
  incompleteSpecialTaskCount: number;
  latestLocation?: {
    latitude: number;
    longitude: number;
    updatedAt: Date;
  } | null;
};

export type StaffAssignmentSelection = {
  staffId: number;
  method: "fresh_gps" | "area_roster_workload";
  distanceMeters: number | null;
};

export const INSPECTOR_ASSIGNMENT_SLA_MS = 15 * 60 * 1000;

export function inspectorAssignmentDueAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + INSPECTOR_ASSIGNMENT_SLA_MS);
}

export function inspectorAssignmentNeedsEscalation(input: {
  completed: boolean;
  dueAt: Date;
  escalatedAt: Date | null;
  now: Date;
}): boolean {
  return (
    !input.completed &&
    input.escalatedAt === null &&
    input.dueAt.getTime() <= input.now.getTime()
  );
}

function normalizeLocation(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function areaAliases(area: InspectorAreaCandidate): Set<string> {
  const name = normalizeLocation(area.name);
  const terminal = normalizeLocation(area.terminal);
  return new Set([
    name,
    normalizeLocation(`${area.terminal} ${area.name}`),
    normalizeLocation(`${area.name} ${area.terminal}`),
    // A few inspectors naturally omit a repeated terminal prefix from the
    // configured name. Keeping both full forms above avoids fuzzy guessing.
    ...(name.startsWith(`${terminal} `)
      ? [normalizeLocation(`${area.terminal} ${area.name.slice(area.terminal.length)}`)]
      : []),
  ]);
}

function exactMatches(
  value: string,
  areas: InspectorAreaCandidate[],
): number[] {
  const normalized = normalizeLocation(value);
  if (!normalized) return [];
  return areas
    .filter((area) => areaAliases(area).has(normalized))
    .map((area) => area.id);
}

function qualifiedMatchesWithDetail(
  value: string,
  areas: InspectorAreaCandidate[],
): number[] {
  const normalized = normalizeLocation(value);
  if (!normalized) return [];
  return areas
    .filter((area) => {
      const qualifiedAliases = [
        normalizeLocation(`${area.terminal} ${area.name}`),
        normalizeLocation(`${area.name} ${area.terminal}`),
      ];
      return qualifiedAliases.some(
        (alias) =>
          normalized === alias ||
          normalized.startsWith(`${alias} `) ||
          normalized.endsWith(` ${alias}`),
      );
    })
    .map((area) => area.id);
}

/**
 * Resolve only a strong, unambiguous area reference. Explicit `Area:` and
 * `Location:` lines take precedence. We intentionally do not fuzzy-match a
 * short name such as "Garden" because several terminals can share it.
 */
export function matchInspectorMessageArea(
  messageBody: string,
  areas: InspectorAreaCandidate[],
): InspectorAreaMatch {
  const lines = messageBody
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const explicitValues = lines
    .map((line) => /^(?:area|location)\s*:\s*(.+)$/i.exec(line)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));

  if (explicitValues.length > 0) {
    const ids = [
      ...new Set(
        explicitValues.flatMap((value) => {
          const exact = exactMatches(value, areas);
          return exact.length > 0
            ? exact
            : qualifiedMatchesWithDetail(value, areas);
        }),
      ),
    ];
    if (ids.length === 1) {
      return { status: "matched", areaId: ids[0]!, matchedBy: "explicit_label" };
    }
    return ids.length > 1
      ? { status: "ambiguous", areaIds: ids.sort((a, b) => a - b) }
      : { status: "missing" };
  }

  const ids = [...new Set(lines.flatMap((line) => exactMatches(line, areas)))];
  if (ids.length === 1) {
    return { status: "matched", areaId: ids[0]!, matchedBy: "exact_line" };
  }
  return ids.length > 1
    ? { status: "ambiguous", areaIds: ids.sort((a, b) => a - b) }
    : { status: "missing" };
}

export function extractInspectorTargetCoordinates(
  messageBody: string,
): TargetCoordinates | null {
  const coordinateLine = /^(?:coordinates?|gps)\s*:\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/im.exec(
    messageBody,
  );
  const latitudeLine = /^lat(?:itude)?\s*:\s*(-?\d{1,3}(?:\.\d+)?)\s*$/im.exec(messageBody);
  const longitudeLine = /^(?:lon|lng|longitude)\s*:\s*(-?\d{1,3}(?:\.\d+)?)\s*$/im.exec(messageBody);
  const latitude = Number(coordinateLine?.[1] ?? latitudeLine?.[1]);
  const longitude = Number(coordinateLine?.[2] ?? longitudeLine?.[1]);
  return Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
    ? { latitude, longitude }
    : null;
}

export function extractInspectorRequestedDate(messageBody: string): string | null {
  const match = /^date\s*:\s*(\d{4}-\d{2}-\d{2})\s*$/im.exec(messageBody);
  if (!match?.[1]) return null;
  const value = match[1];
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

function coordinatesAreValid(location: NonNullable<StaffAssignmentCandidate["latestLocation"]>): boolean {
  return Number.isFinite(location.latitude) &&
    Number.isFinite(location.longitude) &&
    location.latitude >= -90 &&
    location.latitude <= 90 &&
    location.longitude >= -180 &&
    location.longitude <= 180;
}

function haversineMeters(a: TargetCoordinates, b: TargetCoordinates): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLatitude = radians(b.latitude - a.latitude);
  const deltaLongitude = radians(b.longitude - a.longitude);
  const latitude1 = radians(a.latitude);
  const latitude2 = radians(b.latitude);
  const value =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

/** Select only from the already-filtered active on-area roster. */
export function selectAssignedStaff(
  candidates: StaffAssignmentCandidate[],
  target: TargetCoordinates | null,
  now = new Date(),
  freshLocationMs = 30 * 60 * 1000,
  excludedStaffIds: ReadonlySet<number> = new Set(),
): StaffAssignmentSelection | null {
  const eligibleCandidates = candidates.filter(
    (candidate) => !excludedStaffIds.has(candidate.staffId),
  );
  if (eligibleCandidates.length === 0) return null;
  if (target) {
    const gpsCandidates = eligibleCandidates
      .filter((candidate) => {
        const location = candidate.latestLocation;
        return Boolean(
          location &&
            coordinatesAreValid(location) &&
            location.updatedAt.getTime() <= now.getTime() &&
            now.getTime() - location.updatedAt.getTime() <= freshLocationMs,
        );
      })
      .map((candidate) => ({
        staffId: candidate.staffId,
        distanceMeters: haversineMeters(target, candidate.latestLocation!),
      }))
      .sort(
        (a, b) =>
          a.distanceMeters - b.distanceMeters || a.staffId - b.staffId,
      );
    if (gpsCandidates[0]) {
      return {
        staffId: gpsCandidates[0].staffId,
        method: "fresh_gps",
        distanceMeters: Math.round(gpsCandidates[0].distanceMeters),
      };
    }
  }

  const selected = [...eligibleCandidates].sort(
    (a, b) =>
      a.incompleteSpecialTaskCount - b.incompleteSpecialTaskCount ||
      a.staffId - b.staffId,
  )[0]!;
  return {
    staffId: selected.staffId,
    method: "area_roster_workload",
    distanceMeters: null,
  };
}
