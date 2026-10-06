export type McoTerminalArea = {
  name: string;
  terminal: string;
  location: string;
  coverage: string;
  additionalCoverage: string | null;
  sortOrder: number;
  legacyNames: readonly string[];
};

const area = (
  terminal: string,
  name: string,
  coverage: string,
  sortOrder: number,
  legacyNames: readonly string[],
  additionalCoverage: string | null = null,
): McoTerminalArea => ({
  terminal,
  name,
  location: coverage,
  coverage,
  additionalCoverage,
  sortOrder,
  legacyNames,
});

// Canonical operating-area catalog from "Marvol App MCO Terminal_Cleaning_Areas.xlsx"
// (updated 2026-09-28). Legacy names let startup reconciliation preserve existing
// assignments, schedules, issues, photos, and task history while changing the
// user-facing catalog.
export const MCO_TERMINAL_AREAS: readonly McoTerminalArea[] = [
  area("Terminal A - East", "Level 4", "Rows H, J, K, L", 1, [
    "P4 - Row L-H",
    "Level 4 - Row L-H",
    "Terminal A — P4 Row H-L",
    "Terminal A — P4 Row L-H",
    "Terminal A — P4 East",
    "Terminal A — Level P4 East",
    "Level P4 - East",
  ]),
  area("Terminal A - East", "Level 3", "Rows H, J, K, L, M, N, P", 2, [
    "Terminal A — P3 Row H-P",
    "Terminal A — Level 3 Row H-P",
    "Level 3 - Row H-P",
    "Terminal A — P3 East",
    "Terminal A — Level P3 East",
    "Level P3 - East",
  ]),
  area("Terminal A - East", "Level 2", "Rows H, J, K, L, M, N, P", 3, [
    "Terminal A — P2 Row H-P",
    "Terminal A — Level 2 Row H-P",
    "Level 2 - Row H-P",
    "Terminal A — P2 East",
    "Terminal A — Level P2 East",
    "Level P2 - East",
  ]),
  area("Terminal A - East", "Level 1", "Rows H, J, K, L, M, N, P", 4, [
    "Terminal A — P1 Row H-P",
    "Terminal A — Level 1 Row H-P",
    "Level 1 - Row H-P",
    "Terminal A — P1 East",
    "Terminal A — Level P1 East",
    "Level P1 - East",
  ]),
  area("Terminal A - East", "R2", "Avis Pickup", 5, [
    "R2 - Avis",
    "Terminal A — R2 Avis",
    "Terminal A — R2 East",
    "Level R2 - East",
  ]),
  area("Terminal A - East", "R1", "Avis Return", 6, [
    "R1 - Avis",
    "Terminal A — R1 Avis",
    "Terminal A — R1 East",
    "Level R1 - East",
  ]),
  area("Terminal A - East", "Additional — Taxis", "Taxis", 7, [
    "Taxis",
    "Terminal A — Taxis",
    "Taxi Stand",
  ]),
  area("Terminal A - East", "Additional — Checkpoint", "Checkpoint", 8, [
    "Check point",
    "Check Point",
    "Checkpoint",
  ]),
  area("Terminal A - East", "Additional — Garden", "Garden", 9, [
    "Garden",
    "Terminal A — Garden",
  ]),

  area("Terminal A - West", "Level 4", "Rows C, D, E, F, G", 10, [
    "Level 4 - Row C-G",
    "Terminal A — Level 4 Row C-G",
    "Terminal A — P4 Row C-G",
    "Terminal A — P4 West",
    "Level P4 - West",
  ]),
  area("Terminal A - West", "Level 3", "Rows A, B, C, D, E, F, G", 11, [
    "Level 3 - Row A-G",
    "Terminal A — Level 3 Row A-G",
    "Terminal A — P3 Row A-G",
    "Terminal A — P3 West",
    "Level P3 - West",
  ]),
  area("Terminal A - West", "Level 2", "Rows A, B, C, D, E, F, G", 12, [
    "Terminal A — P2 Row A-G",
    "Terminal A — Level 2 Row A-G",
    "Level 2 - Row A-G",
    "Terminal A — P2 West",
    "Terminal A — Level P2 West",
    "Level P2 - West",
  ]),
  area(
    "Terminal A - West",
    "Level 1",
    "Rows D, E, F, G — Public Parking / Sixt Rental Return",
    13,
    [
      "Terminal A — P1 Row D-G",
      "Terminal A — Level 1 Row D-G",
      "Level 1 - Row D-G",
      "Terminal A — P1 West",
      "Terminal A — Level P1 West",
      "Level P1 - West",
    ],
  ),
  area("Terminal A - West", "R2", "Hertz Pickup & Return", 14, [
    "R1 - Hertz",
    "R2 - Hertz",
    "Terminal A — R2 West",
    "Terminal A — Level R2 West",
    "Level R2 - West",
  ]),
  area("Terminal A - West", "R1", "Enterprise Pickup & Return", 15, [
    "R1 - Enterprises",
    "R2 - Enterprises",
    "R1 - Enterprise",
    "Terminal A — R1 West",
    "Terminal A — Level R1 West",
    "Level R1 - West",
  ]),

  area("Terminal B - East", "Level 4", "Rows C, D, E, F, G", 16, [
    "Terminal B — P4 Row C-G",
    "Terminal B — Level 4 Row C-G",
    "Level 4 - Row C-G",
    "Terminal B — P4 East",
    "Terminal B — Level P4 East",
    "Level P4 - East",
  ]),
  area("Terminal B - East", "Level 3", "Rows A, B, C, D, E, F, G", 17, [
    "Terminal B — P3 Row A-G",
    "Terminal B — Level 3 Row A-G",
    "Level 3 - Row A-G",
    "Terminal B — P3 East",
    "Terminal B — Level P3 East",
    "Level P3 - East",
  ]),
  area("Terminal B - East", "Level 2", "Rows A, B, C, D, E, F, G", 18, [
    "Terminal B — P2 Row A-G",
    "Terminal B — Level 2 Row A-G",
    "Level 2 - Row A-G",
    "Terminal B — P2 East",
    "Terminal B — Level P2 East",
    "Level P2 - East",
  ]),
  area(
    "Terminal B - East",
    "Level 1",
    "Rows D, E, F, G — Public Parking / Sixt Rental Return",
    19,
    [
      "Terminal B — P1 Row D-G",
      "Terminal B — Level 1 Row D-G",
      "Level 1 - Row D-G",
      "Terminal B — P1 East",
      "Terminal B — Level P1 East",
      "Level P1 - East",
    ],
  ),
  area("Terminal B - East", "R2", "Avis Pickup & Return", 20, [
    "R2 - Avis",
    "Terminal B — R2 Avis",
    "Terminal B — R2 East",
    "Level R2 - East",
  ]),
  area("Terminal B - East", "R1", "Hertz / Enterprise Return", 21, [
    "R1 - Hertz/Enterprise Return",
    "Terminal B — R1 East",
    "Level R1 - East",
  ]),

  area("Terminal B - West", "Level 4", "Rows H, J, K, L, M", 22, [
    "P4 - Row H-M",
    "Level 4 - Row H-M",
    "Terminal B — P4 Row H-M",
    "Terminal B — P4 West",
    "Terminal B — Level P4 West",
    "Level P4 - West",
  ]),
  area("Terminal B - West", "Level 3", "Rows H, J, K, L, M, N, P", 23, [
    "Terminal B — P3 Row H-P",
    "Terminal B — Level 3 Row H-P",
    "Level 3 - Row H-P",
    "Terminal B — P3 West",
    "Terminal B — Level P3 West",
    "Level P3 - West",
  ]),
  area("Terminal B - West", "Level 2", "Rows H, J, K, L, M, N, P", 24, [
    "Terminal B — P2 Row H-P",
    "Terminal B — Level 2 Row H-P",
    "Level 2 - Row H-P",
    "Terminal B — P2 West",
    "Terminal B — Level P2 West",
    "Level P2 - West",
  ]),
  area("Terminal B - West", "Level 1", "Rows H, J, K, L, M, N, P", 25, [
    "Terminal B — P1 Row H-P",
    "Terminal B — Level 1 Row H-P",
    "Level 1 - Row H-P",
    "Terminal B — P1 West",
    "Terminal B — Level P1 West",
    "Level P1 - West",
  ]),
  area("Terminal B - West", "R2", "Hertz Pickup", 26, [
    "R2 - Hertz",
    "Terminal B — R2 West",
    "Terminal B — Level R2 West",
    "Level R2 - West",
  ]),
  area("Terminal B - West", "R1", "Alamo / Enterprise Pickup", 27, [
    "R1 - Aloma/Enterprise Pick up",
    "R1 - Alamo/Enterprise Pick up",
    "Terminal B — R1 West",
    "Terminal B — Level R1 West",
    "Level R1 - West",
  ]),
  area("Terminal B - West", "Additional — Taxis", "Taxis", 28, [
    "Taxis",
    "Terminal B — Taxis",
    "Taxi Stand",
  ]),
  area("Terminal B - West", "Additional — Garden", "Garden", 29, [
    "Garden",
    "Terminal B — Garden",
  ]),

  area(
    "Terminal C",
    "Group 1 — Level 1 (C1)",
    "Enterprise Return & Pickup; Sixt Return & Pickup",
    30,
    [
      "Level 1 - C1 Enterprise Return",
      "Level 1 - Sixt Return/Pick up",
      "Level 1 - Pedestrian Walkway",
    ],
    "Pedestrian Walkway; all elevator buttons",
  ),
  area(
    "Terminal C",
    "Group 1 — Level 3 (C3)",
    "Rows C59–C69",
    31,
    [
      "Level 3 - C3 C59-C69",
      "Level 3 - Driveway/Pedestrian Walkway to trains",
      "Level 3 - Pedestrian Walkway",
    ],
    "Driveway / Pedestrian Walkway to trains; Small Escalator Levels 3–4; all elevator buttons",
  ),
  area(
    "Terminal C",
    "Group 1 — Level 5 (C5)",
    "Rows C59–C69",
    32,
    ["Level 5 - C5 C59-C69", "Level 5 - Pedestrian Crossing"],
    "Pedestrian Crossing; all elevator buttons",
  ),
  area(
    "Terminal C",
    "Group 2 — Level 2 (C2)",
    "Avis Pickup & Return",
    33,
    [
      "Level 2 - C2 Avis",
      "Level 2 - Pick up/Return Hertz, Return Hertz Pick up",
      "Level 2 - Pedestrian Walkway",
    ],
    "Hertz Pickup pedestrian walkway; Small Escalator Levels 2–1; all elevator buttons",
  ),
  area(
    "Terminal C",
    "Group 2 — Level 4 (C4)",
    "Rows C59–C69",
    34,
    ["Level 4 - C4 C59-C69", "Level 4 - Driveway"],
    "Driveway; Large Escalator Levels 4–2; all elevator buttons",
  ),
  area(
    "Terminal C",
    "Group 2 — Level 6 (C6)",
    "Rows C59–C69",
    35,
    ["Level 6 - C6 C59-C69"],
    "All elevator buttons",
  ),

  area(
    "Top Terminal",
    "Level 4",
    "Side A: Hyatt Parking; Side B: Hyatt Parking",
    36,
    ["Top Terminal — Level 4"],
  ),
  area("Top Terminal", "Level 5", "Side A: Rows A–E; Side B: Rows F–J", 37, [
    "Top Terminal — Level 5",
  ]),
  area("Top Terminal", "Level 6", "Side A: Rows A–E; Side B: Rows F–J", 38, [
    "Top Terminal — Level 6",
  ]),
  area("Top Terminal", "Level 7", "Side A: Rows A–E; Side B: Rows F–J", 39, [
    "Top Terminal — Level 7",
  ]),
  area("Top Terminal", "Level 8", "Side A: Rows A–E; Side B: Rows F–J", 40, [
    "Top Terminal — Level 8",
  ]),
  area("Top Terminal", "Level 9", "Side A: Rows A–E; Side B: Rows F–H", 41, [
    "Top Terminal — Level 9",
  ]),
  area("Top Terminal", "Level 10", "Side A: Rows A–E; Side B: Rows F–H", 42, [
    "Top Terminal — Level 10",
  ]),
  area(
    "Top Terminal",
    "Level 11",
    "Side A: Heliport / Rooftop; Side B: Heliport / Rooftop",
    43,
    ["Top Terminal — Level 11"],
  ),
];

export const DEPRECATED_MCO_AREA_IDENTITIES = [
  { name: "Terminal A - East Garage", terminal: "Terminal A - East" },
  { name: "Terminal A - West Garage", terminal: "Terminal A - West" },
  { name: "Terminal B - East Garage", terminal: "Terminal B - East" },
  { name: "Terminal B - West Garage", terminal: "Terminal B - West" },
  { name: "Terminal C - Levels 1, 3, 5", terminal: "Terminal C" },
  { name: "Terminal C - Levels 2, 4, 6", terminal: "Terminal C" },
  { name: "Top Terminal - Levels 4-11", terminal: "Top Terminal" },
] as const;
