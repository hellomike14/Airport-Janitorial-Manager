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
  "Level P1 - East",
  "Level P1 - West",
  "Level P2 - East",
  "Level P2 - West",
  "Level P3 - East",
  "Level P3 - West",
  "Level P4 - East",
  "Level P4 - West",
  "Level R2 - East",
  "Level R2 - West",
];

const SHARED = new Set(SHARED_AREA_OLD_NAMES);

export function renameSharedAreaName(oldName: string, terminal: string): string {
  if (!SHARED.has(oldName)) return oldName;
  const short = TERMINAL_SHORT[terminal];
  if (!short) return oldName;
  const stripped = oldName
    .replace(/ - /g, " ")
    .replace(/^Level ([PR]\d)\b/, "$1");
  return `${short} — ${stripped}`;
}

const STANDARDIZED_PARKING_LEVEL_RENAMES = Object.entries(TERMINAL_SHORT).flatMap(
  ([terminal, terminalShort]) => {
    const side = terminal.endsWith("East") ? "East" : "West";
    return ["P1", "P2", "P3", "P4", "R1", "R2"].map((level) => ({
      oldName: `${terminalShort} — Level ${level} ${side}`,
      terminal,
      newName: `${terminalShort} — ${level} ${side}`,
    }));
  },
);

const STANDARDIZED_LEVEL_RENAMES: Array<{ oldName: string; terminal: string; newName: string }> = [
  { oldName: "Level 4 - Row L-H", terminal: "Terminal A - East", newName: "P4 - Row L-H" },
  { oldName: "Terminal A — Level 3 Row H-P", terminal: "Terminal A - East", newName: "Terminal A — P3 Row H-P" },
  { oldName: "Terminal A — Level 2 Row H-P", terminal: "Terminal A - East", newName: "Terminal A — P2 Row H-P" },
  { oldName: "Terminal A — Level 1 Row H-P", terminal: "Terminal A - East", newName: "Terminal A — P1 Row H-P" },
  { oldName: "Terminal A — Level 2 Row A-G", terminal: "Terminal A - West", newName: "Terminal A — P2 Row A-G" },
  { oldName: "Terminal A — Level 1 Row D-G", terminal: "Terminal A - West", newName: "Terminal A — P1 Row D-G" },
  { oldName: "Terminal B — Level 4 Row C-G", terminal: "Terminal B - East", newName: "Terminal B — P4 Row C-G" },
  { oldName: "Terminal B — Level 3 Row A-G", terminal: "Terminal B - East", newName: "Terminal B — P3 Row A-G" },
  { oldName: "Terminal B — Level 2 Row A-G", terminal: "Terminal B - East", newName: "Terminal B — P2 Row A-G" },
  { oldName: "Terminal B — Level 1 Row D-G", terminal: "Terminal B - East", newName: "Terminal B — P1 Row D-G" },
  { oldName: "Level 4 - Row H-M", terminal: "Terminal B - West", newName: "P4 - Row H-M" },
  { oldName: "Terminal B — Level 3 Row H-P", terminal: "Terminal B - West", newName: "Terminal B — P3 Row H-P" },
  { oldName: "Terminal B — Level 2 Row H-P", terminal: "Terminal B - West", newName: "Terminal B — P2 Row H-P" },
  { oldName: "Terminal B — Level 1 Row H-P", terminal: "Terminal B - West", newName: "Terminal B — P1 Row H-P" },
];

export const AREA_RENAME_MAP: Array<{ oldName: string; terminal: string; newName: string }> = [
  ...Object.keys(TERMINAL_SHORT).flatMap((terminal) =>
    SHARED_AREA_OLD_NAMES.map((oldName) => ({
      oldName,
      terminal,
      newName: renameSharedAreaName(oldName, terminal),
    })),
  ),
  ...STANDARDIZED_PARKING_LEVEL_RENAMES,
  ...STANDARDIZED_LEVEL_RENAMES,
];
