const TERMINAL_SHORT: Record<string, string> = {
  "Terminal A - East": "Terminal A",
  "Terminal A - West": "Terminal A",
  "Terminal B - East": "Terminal B",
  "Terminal B - West": "Terminal B",
};

const SHARED_AREA_OLD_NAMES = [
  "Level 4 - Row C-G",
  "Level 3 - Row A-G",
  "Level 2 - Row A-G",
  "Level 1 - Row D-G",
  "Level 3 - Row H-P",
  "Level 2 - Row H-P",
  "Level 1 - Row H-P",
  "R2 - Avis",
  "Taxis",
  "Garden",
];

const SHARED = new Set(SHARED_AREA_OLD_NAMES);

export function renameSharedAreaName(oldName: string, terminal: string): string {
  if (!SHARED.has(oldName)) return oldName;
  const short = TERMINAL_SHORT[terminal];
  if (!short) return oldName;
  const stripped = oldName.replace(/ - /g, " ");
  return `${short} — ${stripped}`;
}

export const AREA_RENAME_MAP: Array<{ oldName: string; terminal: string; newName: string }> =
  Object.keys(TERMINAL_SHORT).flatMap((terminal) =>
    SHARED_AREA_OLD_NAMES.map((oldName) => ({
      oldName,
      terminal,
      newName: renameSharedAreaName(oldName, terminal),
    })),
  );
