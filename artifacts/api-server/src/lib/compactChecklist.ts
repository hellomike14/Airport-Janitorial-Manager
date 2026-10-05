export type EffectiveTask = {
  taskName: string;
  taskOrder: number;
  photoRequired?: boolean;
  notes?: string;
};

/** Keep every scoped duty (including named bins and before/after lunch rounds)
 * as instructions, while replacing oversized tick lists with six work groups.
 * Single-purpose areas retain their small, specific checklist.
 */
export function compactChecklist(tasks: EffectiveTask[]): EffectiveTask[] {
  const unique = [
    ...new Map(tasks.map((t) => [t.taskName.trim().toLowerCase(), t])).values(),
  ];
  if (unique.length <= 7)
    return unique.map((t) => ({
      ...t,
      photoRequired: /trash|sweep|spill|stain/i.test(t.taskName),
    }));
  const groups = [
    {
      taskName: "Sweep and clean floors and pedestrian routes",
      photoRequired: true,
      match: /sweep|floor|gum|debris|litter/i,
    },
    {
      taskName:
        "Empty and clean all assigned trash bins; complete every required round",
      photoRequired: true,
      match: /trash|bin|liner|receptacle|cigarette|before lunch|after lunch/i,
    },
    {
      taskName: "Clean stairwells, steps, landings and handrails",
      photoRequired: false,
      match: /stair|landing|handrail/i,
    },
    {
      taskName: "Clean elevators and sanitize high-touch surfaces",
      photoRequired: false,
      match: /elevator|high.touch|button|sanitiz/i,
    },
    {
      taskName: "Spot-clean walls, signs, glass and spills",
      photoRequired: true,
      match: /wall|pillar|sign|partition|glass|door|spill|stain|entry|exit/i,
    },
    {
      taskName:
        "Inspect drains and safety hazards; finish inspection and handover",
      photoRequired: false,
      match: /./,
    },
  ];
  const duties = groups.map(() => [] as string[]);
  for (const task of unique) {
    // Trash duties mention floor levels; categorize the specific work first.
    const priority =
      /trash|bin|liner|receptacle|before lunch|after lunch/i.test(task.taskName)
        ? 1
        : /stair|landing|handrail/i.test(task.taskName)
          ? 2
          : /elevator/i.test(task.taskName)
            ? 3
            : /inspect|hazard|drain|sign.off/i.test(task.taskName)
              ? 5
              : groups.findIndex((g) => g.match.test(task.taskName));
    duties[priority].push(task.taskName);
  }
  return groups.flatMap((group, i) =>
    duties[i].length
      ? [
          {
            taskName: group.taskName,
            taskOrder: i + 1,
            photoRequired: group.photoRequired,
            notes: duties[i].map((duty) => `• ${duty}`).join("\n"),
          },
        ]
      : [],
  );
}
