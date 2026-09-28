export const TERMINAL_GROUP_KEYS = [
  "terminal-a-east",
  "terminal-a-west",
  "terminal-b-east",
  "terminal-b-west",
  "terminal-c-135",
  "terminal-c-246",
  "top-terminal",
] as const;

export type TerminalGroupKey = (typeof TERMINAL_GROUP_KEYS)[number];

export function areaBelongsToGroup(
  area: { name: string; terminal: string; location: string },
  groupKey: TerminalGroupKey,
): boolean {
  const terminalForGroup: Partial<Record<TerminalGroupKey, string>> = {
    "terminal-a-east": "Terminal A - East",
    "terminal-a-west": "Terminal A - West",
    "terminal-b-east": "Terminal B - East",
    "terminal-b-west": "Terminal B - West",
    "top-terminal": "Top Terminal",
  };
  if (groupKey in terminalForGroup) return area.terminal === terminalForGroup[groupKey];
  if (area.terminal !== "Terminal C") return false;

  const groupNumber = groupKey === "terminal-c-135" ? "1" : "2";
  if (area.name.startsWith(`Group ${groupNumber} —`)) return true;

  // Older areas can still exist before catalog reconciliation. Keep their
  // group membership consistent with the canonical Terminal C catalog.
  const levels = groupNumber === "1" ? [1, 3, 5] : [2, 4, 6];
  if (area.name.startsWith(`Terminal C - Levels ${levels.join(", ")}`)) return true;
  const levelMatch = /^(?:Level |Group \d — Level )([1-6])\b/.exec(area.name);
  return levelMatch ? levels.includes(Number(levelMatch[1])) : false;
}

export function planGroupAssignment(
  areaIds: number[],
  existing: { areaId: number; staffId: number }[],
  staffId: number,
): { missingIds: number[]; existingCount: number } | null {
  if (existing.some((row) => row.staffId !== staffId)) return null;
  const existingIds = new Set(existing.map((row) => row.areaId));
  return {
    missingIds: areaIds.filter((id) => !existingIds.has(id)),
    existingCount: existingIds.size,
  };
}