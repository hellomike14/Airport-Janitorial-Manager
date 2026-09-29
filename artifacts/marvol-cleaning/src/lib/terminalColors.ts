const TERMINAL_COLORS: Record<string, { ring: string; bg: string; dot: string; bar: string; text: string }> = {
  "Terminal A": { ring: "ring-orange-200", bg: "bg-orange-50", dot: "bg-orange-500", bar: "bg-orange-500", text: "text-orange-700" },
  "Terminal B": { ring: "ring-green-200", bg: "bg-green-50", dot: "bg-green-500", bar: "bg-green-500", text: "text-green-700" },
  "Terminal C": { ring: "ring-blue-200", bg: "bg-blue-50", dot: "bg-blue-500", bar: "bg-blue-500", text: "text-blue-700" },
  "Top Terminal": { ring: "ring-amber-200", bg: "bg-amber-50", dot: "bg-amber-500", bar: "bg-amber-500", text: "text-amber-700" },
};

export function getTerminalColors(terminal: string) {
  const group = terminal.startsWith("Terminal A") ? "Terminal A"
    : terminal.startsWith("Terminal B") ? "Terminal B"
    : terminal.startsWith("Terminal C") ? "Terminal C"
    : terminal;
  return TERMINAL_COLORS[group] ?? { ring: "ring-slate-200", bg: "bg-slate-50", dot: "bg-slate-400", bar: "bg-slate-400", text: "text-slate-700" };
}