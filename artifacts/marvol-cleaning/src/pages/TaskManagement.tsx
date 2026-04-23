import React, { useState, useMemo } from "react";
import { format, addDays, subDays, parseISO } from "date-fns";
import { useTranslation } from "react-i18next";
import { getDateLocale } from "@/i18n/dateLocale";
import {
  useListTasks,
  useListAreas,
  useCompleteTask,
  useUncompleteTask,
  useCompleteAllTasks,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  CheckCircle2,
  Circle,
  Clock,
  ChevronDown,
  ChevronRight,
  CheckCheck,
  ChevronLeft,
  Search,
  Filter,
  BarChart3,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StaffName } from "@/components/StaffName";

type StatusFilter = "all" | "pending" | "completed";

const TERMINAL_COLORS: Record<string, { ring: string; bg: string; dot: string; bar: string }> = {
  "Terminal A": { ring: "ring-blue-200", bg: "bg-blue-50", dot: "bg-blue-500", bar: "bg-blue-500" },
  "Terminal B": { ring: "ring-violet-200", bg: "bg-violet-50", dot: "bg-violet-500", bar: "bg-violet-500" },
  "Terminal C": { ring: "ring-emerald-200", bg: "bg-emerald-50", dot: "bg-emerald-500", bar: "bg-emerald-500" },
  "Top Terminal": { ring: "ring-amber-200", bg: "bg-amber-50", dot: "bg-amber-500", bar: "bg-amber-500" },
};

function getColors(terminal: string) {
  return TERMINAL_COLORS[terminal] ?? { ring: "ring-slate-200", bg: "bg-slate-50", dot: "bg-slate-400", bar: "bg-slate-400" };
}

export default function TaskManagement() {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateLocale(i18n.language);
  const { currentUser } = useAuth();
  const qc = useQueryClient();

  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [areaFilter, setAreaFilter] = useState<number | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});

  const { data: areas } = useListAreas();
  const { data: tasks, isLoading } = useListTasks({ date });

  const completeMutation = useCompleteTask({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/tasks"] }) },
  });
  const uncompleteMutation = useUncompleteTask({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/tasks"] }) },
  });
  const completeAllMutation = useCompleteAllTasks({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/tasks"] }) },
  });

  const userId = currentUser?.id ?? 1;

  const toggleTask = (task: any) => {
    if (task.completed) {
      uncompleteMutation.mutate({ id: task.id });
    } else {
      completeMutation.mutate({ id: task.id, data: { completedById: userId } });
    }
  };

  const toggleCollapse = (areaId: number) => {
    setCollapsed((prev) => ({ ...prev, [areaId]: !prev[areaId] }));
  };

  const grouped = useMemo(() => {
    const taskList = tasks ?? [];
    const areaList = areas ?? [];

    return areaList
      .filter((a) => areaFilter === "all" || a.id === areaFilter)
      .map((area) => {
        let areaTasks = taskList.filter((t) => t.areaId === area.id);
        if (statusFilter === "pending") areaTasks = areaTasks.filter((t) => !t.completed);
        if (statusFilter === "completed") areaTasks = areaTasks.filter((t) => t.completed);
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          areaTasks = areaTasks.filter((t) => t.taskName.toLowerCase().includes(q));
        }
        const total = taskList.filter((t) => t.areaId === area.id).length;
        const completed = taskList.filter((t) => t.areaId === area.id && t.completed).length;
        return { area, tasks: areaTasks, total, completed };
      })
      .filter((g) => g.tasks.length > 0 || (areaFilter !== "all" && g.area.id === areaFilter));
  }, [tasks, areas, areaFilter, statusFilter, search]);

  const totalTasks = (tasks ?? []).length;
  const totalCompleted = (tasks ?? []).filter((t) => t.completed).length;
  const totalPending = totalTasks - totalCompleted;
  const pct = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0;

  const changeDate = (delta: number) => {
    const d = parseISO(date);
    setDate(format(delta > 0 ? addDays(d, delta) : subDays(d, Math.abs(delta)), "yyyy-MM-dd"));
  };

  const STATUS_LABELS: Record<StatusFilter, string> = {
    all: t("taskManagement.all"),
    pending: t("common.pending").toLowerCase(),
    completed: t("common.completed").toLowerCase(),
  };

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{t("taskManagement.title")}</h1>
          <p className="text-slate-500 mt-1 text-sm">{t("taskManagement.subtitle")}</p>
        </div>

        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm self-start sm:self-auto">
          <button
            onClick={() => changeDate(-1)}
            className="p-1 rounded-lg hover:bg-slate-100 transition-colors text-slate-500 hover:text-slate-800"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="text-sm font-semibold text-slate-700 bg-transparent outline-none cursor-pointer"
          />
          <button
            onClick={() => changeDate(1)}
            className="p-1 rounded-lg hover:bg-slate-100 transition-colors text-slate-500 hover:text-slate-800"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {date !== format(new Date(), "yyyy-MM-dd") && (
            <button
              onClick={() => setDate(format(new Date(), "yyyy-MM-dd"))}
              className="ml-1 text-xs text-accent font-semibold hover:underline"
            >
              {t("common.today")}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: t("taskManagement.totalTasks"), value: totalTasks, color: "text-slate-700", bg: "bg-slate-50 border-slate-200" },
          { label: t("taskManagement.completed"), value: totalCompleted, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" },
          { label: t("taskManagement.pending"), value: totalPending, color: "text-amber-600", bg: "bg-amber-50 border-amber-200" },
          { label: t("taskManagement.overallPercent"), value: `${pct}%`, color: "text-blue-600", bg: "bg-blue-50 border-blue-200" },
        ].map((s) => (
          <div key={s.label} className={`rounded-2xl border px-5 py-4 ${s.bg}`}>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{s.label}</p>
            <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl px-5 py-3 flex items-center gap-4 shadow-sm">
        <BarChart3 className="w-4 h-4 text-slate-400 shrink-0" />
        <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${pct === 100 ? "bg-emerald-500" : "bg-blue-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-sm font-bold text-slate-600 shrink-0 min-w-[40px] text-right">{pct}%</span>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("common.searchTasks")}
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 overflow-x-auto shrink-0">
          <button
            onClick={() => setAreaFilter("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${areaFilter === "all" ? "bg-slate-900 text-white shadow" : "text-slate-500 hover:text-slate-800"}`}
          >
            {t("taskManagement.allAreas")}
          </button>
          {(areas ?? []).map((a) => (
            <button
              key={a.id}
              onClick={() => setAreaFilter(a.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${areaFilter === a.id ? "bg-slate-900 text-white shadow" : "text-slate-500 hover:text-slate-800"}`}
            >
              {a.name.replace("Terminal ", "T").replace(" Garage", "").replace("Levels ", "L")}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shrink-0">
          {(["all", "pending", "completed"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${statusFilter === s ? "bg-slate-900 text-white shadow" : "text-slate-500 hover:text-slate-800"}`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 bg-slate-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Filter className="w-10 h-10 text-slate-300 mb-3" />
          <p className="text-slate-600 font-semibold">{t("taskManagement.noMatchingFilters")}</p>
          <p className="text-slate-400 text-sm mt-1">{t("taskManagement.adjustFilters")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ area, tasks: areaTasks, total, completed }) => {
            const col = getColors(area.terminal);
            const pctArea = total > 0 ? Math.round((completed / total) * 100) : 0;
            const allDone = total > 0 && completed === total;
            const isCollapsed = collapsed[area.id];
            const pending = areaTasks.filter((t) => !t.completed);
            const done = areaTasks.filter((t) => t.completed);
            const displayTasks = statusFilter === "pending" ? pending : statusFilter === "completed" ? done : areaTasks;

            return (
              <div key={area.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${allDone ? "border-emerald-200" : "border-slate-200"}`}>
                <div
                  className={`flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-slate-50/60 transition-colors ${allDone ? "bg-emerald-50/60" : ""}`}
                  onClick={() => toggleCollapse(area.id)}
                >
                  <div className={`w-3 h-3 rounded-full ${allDone ? "bg-emerald-500" : col.dot} shrink-0`} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h2 className="font-bold text-slate-800">{area.name}</h2>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${col.bg} ${col.ring} ring-1 text-slate-600`}>
                        {area.terminal}
                      </span>
                      {allDone && (
                        <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> {t("taskManagement.complete")}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5">
                      <div className="flex-1 max-w-[200px] h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${allDone ? "bg-emerald-500" : col.bar}`}
                          style={{ width: `${pctArea}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-500 font-medium">{completed}/{total} · {pctArea}%</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!allDone && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          completeAllMutation.mutate({ data: { areaId: area.id, date, completedById: userId } });
                        }}
                        className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-emerald-600 bg-slate-100 hover:bg-emerald-50 px-3 py-1.5 rounded-lg transition-all border border-transparent hover:border-emerald-200"
                      >
                        <CheckCheck className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{t("taskManagement.completeAll")}</span>
                      </button>
                    )}
                    {isCollapsed
                      ? <ChevronRight className="w-4 h-4 text-slate-400" />
                      : <ChevronDown className="w-4 h-4 text-slate-400" />
                    }
                  </div>
                </div>

                {!isCollapsed && (
                  <>
                    <div className={`h-px ${allDone ? "bg-emerald-100" : "bg-slate-100"}`} />
                    <div className="divide-y divide-slate-50">
                      {displayTasks.map((task) => (
                        <div
                          key={task.id}
                          className={`flex items-start gap-4 px-5 py-3 hover:bg-slate-50/70 transition-colors group ${task.completed ? "opacity-65" : ""}`}
                        >
                          <button
                            onClick={() => toggleTask(task)}
                            className="mt-0.5 shrink-0 transition-transform active:scale-90"
                          >
                            {task.completed
                              ? <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                              : <Circle className="w-5 h-5 text-slate-300 group-hover:text-blue-400 transition-colors" />
                            }
                          </button>

                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${task.completed ? "line-through text-slate-400" : "text-slate-700"}`}>
                              {task.taskName}
                            </p>
                            {task.isSpecial && (
                              <span className="inline-block mt-0.5 text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                {t("taskManagement.specialInspectorRequest")}
                              </span>
                            )}
                            {task.notes && (
                              <p className="text-xs text-slate-400 italic mt-0.5">"{task.notes}"</p>
                            )}
                          </div>

                          <div className="shrink-0 text-right pt-0.5">
                            {task.completed ? (
                              <div className="flex flex-col items-end gap-0.5">
                                <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {task.completedAt ? format(new Date(task.completedAt), "h:mm a", { locale: dateLocale }) : t("common.done")}
                                </span>
                                {task.completedByName && (
                                  <span className="text-[10px] text-slate-400">
                                    <StaffName name={task.completedByName} />
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">{t("common.pending")}</span>
                            )}
                          </div>
                        </div>
                      ))}

                      {displayTasks.length === 0 && (
                        <div className="px-5 py-6 text-center text-sm text-slate-400">
                          {t("taskManagement.noTasksMatch", { status: statusFilter !== "all" ? STATUS_LABELS[statusFilter] : "" })}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
