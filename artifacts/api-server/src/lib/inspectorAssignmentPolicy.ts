export type InspectorAreaCandidate = { id: number; name: string; terminal: string };
export type TargetCoordinates = { latitude: number; longitude: number };
export type StaffAssignmentCandidate = { staffId: number; incompleteSpecialTaskCount: number; latestLocation?: { latitude: number; longitude: number; accuracy: number | null; updatedAt: Date } | null };
export const INSPECTOR_ASSIGNMENT_SLA_MS = 15 * 60 * 1000;
export const inspectorAssignmentDueAt = (created: Date) => new Date(created.getTime() + INSPECTOR_ASSIGNMENT_SLA_MS);

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
const aliases = (area: InspectorAreaCandidate) => new Set([normalize(area.name), normalize(`${area.terminal} ${area.name}`), normalize(`${area.name} ${area.terminal}`)]);

/** Deliberately strict: only an exact configured name or qualified name is accepted. */
export function matchInspectorMessageArea(body: string, areas: InspectorAreaCandidate[]): { status: "matched"; areaId: number } | { status: "missing" | "ambiguous" } {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const requested = lines.map((line) => /^(?:area|location)\s*:\s*(.+)$/i.exec(line)?.[1] ?? line);
  const ids = [...new Set(requested.flatMap((value) => areas.filter((area) => aliases(area).has(normalize(value))).map((area) => area.id)))];
  return ids.length === 1 ? { status: "matched", areaId: ids[0]! } : { status: ids.length ? "ambiguous" : "missing" };
}
export function extractInspectorTargetCoordinates(body: string): TargetCoordinates | null {
  const match = /^(?:coordinates?|gps)\s*:\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/im.exec(body);
  const latitude = Number(match?.[1]), longitude = Number(match?.[2]);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 ? { latitude, longitude } : null;
}
function distance(a: TargetCoordinates, b: TargetCoordinates) {
  const rad = (n: number) => n * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude), dLon = rad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 12742000 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
export function selectAssignedStaff(candidates: StaffAssignmentCandidate[], target: TargetCoordinates | null, now = new Date(), excluded = new Set<number>()) {
  const eligible = candidates.filter((candidate) => !excluded.has(candidate.staffId));
  const freshnessMs = Math.max(30_000, Number(process.env.INSPECTOR_GPS_FRESHNESS_SECONDS ?? 300) * 1000);
  const maxAccuracy = Math.max(1, Number(process.env.INSPECTOR_GPS_MAX_ACCURACY_METERS ?? 50));
  const gps = target ? eligible.filter((candidate) => candidate.latestLocation && candidate.latestLocation.accuracy !== null && Number.isFinite(candidate.latestLocation.accuracy) && candidate.latestLocation.accuracy <= maxAccuracy && now.getTime() >= candidate.latestLocation.updatedAt.getTime() && now.getTime() - candidate.latestLocation.updatedAt.getTime() <= freshnessMs)
    .map((candidate) => ({ candidate, meters: distance(target, candidate.latestLocation!) })).sort((a, b) => a.meters - b.meters || a.candidate.staffId - b.candidate.staffId)[0] : undefined;
  if (gps) return { staffId: gps.candidate.staffId, method: "fresh_gps" as const, distanceMeters: Math.round(gps.meters) };
  const selected = eligible.sort((a, b) => a.incompleteSpecialTaskCount - b.incompleteSpecialTaskCount || a.staffId - b.staffId)[0];
  return selected ? { staffId: selected.staffId, method: "area_roster_workload" as const, distanceMeters: null } : null;
}