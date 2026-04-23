import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Users,
  MapPin,
  Camera,
  Bell,
  TrendingUp,
  Printer,
  Calendar,
  ChevronDown,
  ChevronUp,
  User,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from "date-fns";
import { getDateLocale } from "@/i18n/dateLocale";
import { StaffName } from "@/components/StaffName";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type WeeklyReportData = {
  weekStart: string;
  weekEnd: string;
  tasks: {
    total: number;
    completed: number;
    completionRate: number;
    byDay: { date: string; total: number; completed: number }[];
  };
  issues: {
    total: number;
    resolved: number;
    open: number;
    resolutionRate: number;
    bySeverity: { high: number; medium: number; low: number };
    byArea: { areaName: string; terminal: string; count: number }[];
  };
  staffProductivity: {
    staffId: number;
    staffName: string;
    staffRole: string;
    staffActive?: boolean;
    tasksCompleted: number;
  }[];
  staffBreakdown: {
    staffId: number;
    staffName: string;
    staffRole: string;
    staffActive?: boolean;
    tasksCompleted: number;
    specialRequestsCompleted: number;
    issuesResolved: number;
    issuesReported: number;
    photosShared: number;
    areasWorked: number;
  }[];
  areaPerformance: {
    areaId: number;
    areaName: string;
    terminal: string;
    total: number;
    completed: number;
    completionRate: number;
  }[];
  photosShared: number;
  notificationsSent: number;
};

function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subValue?: string;
  color: string;
}) {
  const colorClasses: Record<string, string> = {
    emerald: "from-emerald-500 to-teal-500",
    blue: "from-blue-500 to-indigo-500",
    amber: "from-amber-500 to-orange-500",
    violet: "from-violet-500 to-purple-500",
    rose: "from-rose-500 to-pink-500",
    cyan: "from-cyan-500 to-sky-500",
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${colorClasses[color] ?? colorClasses.blue} flex items-center justify-center shrink-0`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-800">{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
        {subValue && <p className="text-[10px] text-slate-400 mt-0.5">{subValue}</p>}
      </div>
    </div>
  );
}

function ProgressBar({ value, max, color = "emerald" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const colorMap: Record<string, string> = {
    emerald: "bg-emerald-500",
    blue: "bg-blue-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
  };
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colorMap[color] ?? colorMap.emerald} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-slate-600 w-10 text-right">{pct}%</span>
    </div>
  );
}

function StaffBreakdownSection({ staffBreakdown }: { staffBreakdown: WeeklyReportData["staffBreakdown"] }) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const ROLE_COLORS: Record<string, string> = {
    staff: "bg-blue-100 text-blue-700",
    supervisor: "bg-violet-100 text-violet-700",
    inspector: "bg-amber-100 text-amber-700",
    admin: "bg-rose-100 text-rose-700",
  };

  if (staffBreakdown.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <User className="w-4 h-4 text-indigo-500" />
          {t("weeklyReport.staffBreakdown")}
        </h3>
        <p className="text-sm text-slate-400 text-center py-4">{t("weeklyReport.noActivity")}</p>
      </div>
    );
  }

  const maxTasks = Math.max(...staffBreakdown.map((s) => s.tasksCompleted), 1);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <User className="w-4 h-4 text-indigo-500" />
            {t("weeklyReport.staffBreakdown")}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">{t("weeklyReport.staffBreakdownSubtitle")}</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-2 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("weeklyReport.staffPerformance")}</th>
              <th className="text-center py-2 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t("weeklyReport.regularTasks")}</th>
              <th className="text-center py-2 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t("weeklyReport.specialReqs")}</th>
              <th className="text-center py-2 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t("weeklyReport.issuesFixed")}</th>
              <th className="text-center py-2 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t("weeklyReport.reported")}</th>
              <th className="text-center py-2 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t("weeklyReport.photos")}</th>
              <th className="text-center py-2 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t("weeklyReport.areas")}</th>
            </tr>
          </thead>
          <tbody>
            {staffBreakdown.map((s, i) => {
              const isExpanded = expandedId === s.staffId;
              return (
                <React.Fragment key={s.staffId}>
                  <tr
                    className={`border-b border-slate-50 hover:bg-slate-50/50 cursor-pointer transition-colors ${isExpanded ? "bg-indigo-50/40" : ""}`}
                    onClick={() => setExpandedId(isExpanded ? null : s.staffId)}
                  >
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 ${i === 0 ? "bg-amber-500" : i === 1 ? "bg-slate-400" : i === 2 ? "bg-amber-700" : "bg-slate-300"}`}>
                          {i + 1}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">
                            <StaffName name={s.staffName} active={s.staffActive} />
                          </p>
                          <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize ${ROLE_COLORS[s.staffRole] ?? "bg-slate-100 text-slate-600"}`}>{s.staffRole}</span>
                        </div>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                      </div>
                    </td>
                    <td className="text-center py-3 px-2">
                      <span className={`inline-flex items-center justify-center min-w-[28px] h-7 rounded-lg text-sm font-bold ${s.tasksCompleted > 0 ? "bg-emerald-50 text-emerald-700" : "text-slate-300"}`}>
                        {s.tasksCompleted}
                      </span>
                    </td>
                    <td className="text-center py-3 px-2">
                      <span className={`inline-flex items-center justify-center min-w-[28px] h-7 rounded-lg text-sm font-bold ${s.specialRequestsCompleted > 0 ? "bg-violet-50 text-violet-700" : "text-slate-300"}`}>
                        {s.specialRequestsCompleted}
                      </span>
                    </td>
                    <td className="text-center py-3 px-2">
                      <span className={`inline-flex items-center justify-center min-w-[28px] h-7 rounded-lg text-sm font-bold ${s.issuesResolved > 0 ? "bg-blue-50 text-blue-700" : "text-slate-300"}`}>
                        {s.issuesResolved}
                      </span>
                    </td>
                    <td className="text-center py-3 px-2">
                      <span className={`inline-flex items-center justify-center min-w-[28px] h-7 rounded-lg text-sm font-bold ${s.issuesReported > 0 ? "bg-amber-50 text-amber-700" : "text-slate-300"}`}>
                        {s.issuesReported}
                      </span>
                    </td>
                    <td className="text-center py-3 px-2">
                      <span className={`inline-flex items-center justify-center min-w-[28px] h-7 rounded-lg text-sm font-bold ${s.photosShared > 0 ? "bg-cyan-50 text-cyan-700" : "text-slate-300"}`}>
                        {s.photosShared}
                      </span>
                    </td>
                    <td className="text-center py-3 px-2">
                      <span className={`inline-flex items-center justify-center min-w-[28px] h-7 rounded-lg text-sm font-bold ${s.areasWorked > 0 ? "bg-indigo-50 text-indigo-700" : "text-slate-300"}`}>
                        {s.areasWorked}
                      </span>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-indigo-50/30">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="ml-9 flex items-center gap-4">
                          <span className="text-xs text-slate-500 font-medium whitespace-nowrap">{t("weeklyReport.completionRate")}:</span>
                          <div className="w-64">
                            <ProgressBar value={s.tasksCompleted} max={maxTasks} color={s.tasksCompleted >= maxTasks * 0.8 ? "emerald" : s.tasksCompleted >= maxTasks * 0.5 ? "amber" : "rose"} />
                          </div>
                          <span className="text-xs text-slate-400">{s.tasksCompleted} / {maxTasks} {t("weeklyReport.tasks")}</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function WeeklyReport() {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateLocale(i18n.language);
  const [currentWeek, setCurrentWeek] = useState(new Date());

  const weekStart = format(startOfWeek(currentWeek, { weekStartsOn: 0 }), "yyyy-MM-dd");
  const weekEnd = format(endOfWeek(currentWeek, { weekStartsOn: 0 }), "yyyy-MM-dd");

  const { data, isLoading } = useQuery<WeeklyReportData>({
    queryKey: ["/api/weekly-report", weekStart, weekEnd],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/weekly-report?from=${weekStart}&to=${weekEnd}`);
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
  });

  const prevWeek = () => setCurrentWeek((d) => subWeeks(d, 1));
  const nextWeek = () => setCurrentWeek((d) => addWeeks(d, 1));

  const DAY_NAMES_SHORT = [
    t("report.sun"), t("report.mon"), t("report.tue"),
    t("report.wed"), t("report.thu"), t("report.fri"), t("report.sat"),
  ];

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            {t("weeklyReport.title")}
          </h1>
          <p className="text-slate-500 text-sm mt-1">{t("weeklyReport.subtitle")}</p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={prevWeek} className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="px-4 py-2 bg-white rounded-xl border border-slate-200 text-sm font-medium text-slate-700 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-violet-500" />
            {format(new Date(weekStart + "T12:00:00"), "MMM d", { locale: dateLocale })} — {format(new Date(weekEnd + "T12:00:00"), "MMM d, yyyy", { locale: dateLocale })}
          </div>
          <button onClick={nextWeek} className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors">
            <ChevronRight className="w-5 h-5" />
          </button>
          <button
            onClick={() => window.print()}
            className="ml-2 flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"
          >
            <Printer className="w-4 h-4" />
            {t("weeklyReport.print")}
          </button>
        </div>
      </div>

      <div className="hidden print:block text-center mb-4">
        <h1 className="text-xl font-bold">{t("weeklyReport.title")}</h1>
        <p className="text-sm text-slate-500">
          {format(new Date(weekStart + "T12:00:00"), "MMMM d", { locale: dateLocale })} — {format(new Date(weekEnd + "T12:00:00"), "MMMM d, yyyy", { locale: dateLocale })}
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-slate-400">{t("common.loading")}</div>
      ) : !data ? (
        <div className="text-center py-16 text-slate-400">{t("weeklyReport.noData")}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard icon={CheckCircle2} label={t("weeklyReport.tasksCompleted")} value={data.tasks.completed} subValue={`${t("weeklyReport.of")} ${data.tasks.total}`} color="emerald" />
            <StatCard icon={TrendingUp} label={t("weeklyReport.completionRate")} value={`${data.tasks.completionRate}%`} color="blue" />
            <StatCard icon={AlertTriangle} label={t("weeklyReport.issuesReported")} value={data.issues.total} subValue={`${data.issues.resolved} ${t("weeklyReport.resolved")}`} color="amber" />
            <StatCard icon={Users} label={t("weeklyReport.activeStaff")} value={data.staffProductivity.length} color="violet" />
            <StatCard icon={Camera} label={t("weeklyReport.photosShared")} value={data.photosShared} color="cyan" />
            <StatCard icon={Bell} label={t("weeklyReport.notifications")} value={data.notificationsSent} color="rose" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                {t("weeklyReport.dailyTaskCompletion")}
              </h3>
              <div className="space-y-3">
                {data.tasks.byDay.map((day, i) => {
                  const dayDate = new Date(day.date + "T12:00:00");
                  const dayIdx = dayDate.getDay();
                  return (
                    <div key={day.date}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-600">
                          {DAY_NAMES_SHORT[dayIdx]} {format(dayDate, "M/d")}
                        </span>
                        <span className="text-xs text-slate-400">
                          {day.completed}/{day.total}
                        </span>
                      </div>
                      <ProgressBar value={day.completed} max={day.total} />
                    </div>
                  );
                })}
                {data.tasks.byDay.length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-4">{t("weeklyReport.noTasks")}</p>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                {t("weeklyReport.issueSummary")}
              </h3>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center p-3 rounded-xl bg-red-50 border border-red-100">
                  <p className="text-lg font-bold text-red-600">{data.issues.bySeverity.high}</p>
                  <p className="text-[10px] text-red-500 font-medium uppercase">{t("weeklyReport.high")}</p>
                </div>
                <div className="text-center p-3 rounded-xl bg-amber-50 border border-amber-100">
                  <p className="text-lg font-bold text-amber-600">{data.issues.bySeverity.medium}</p>
                  <p className="text-[10px] text-amber-500 font-medium uppercase">{t("weeklyReport.medium")}</p>
                </div>
                <div className="text-center p-3 rounded-xl bg-blue-50 border border-blue-100">
                  <p className="text-lg font-bold text-blue-600">{data.issues.bySeverity.low}</p>
                  <p className="text-[10px] text-blue-500 font-medium uppercase">{t("weeklyReport.low")}</p>
                </div>
              </div>
              <div className="mb-2">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>{t("weeklyReport.resolutionRate")}</span>
                  <span>{data.issues.resolutionRate}%</span>
                </div>
                <ProgressBar value={data.issues.resolved} max={data.issues.total} color="amber" />
              </div>
              {data.issues.byArea.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase">{t("weeklyReport.topIssueAreas")}</p>
                  {data.issues.byArea.slice(0, 5).map((a, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600 flex items-center gap-1.5">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        {a.terminal} - {a.areaName}
                      </span>
                      <span className="font-semibold text-slate-700">{a.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 text-violet-500" />
                {t("weeklyReport.staffPerformance")}
              </h3>
              <div className="space-y-3">
                {data.staffProductivity.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">{t("weeklyReport.noActivity")}</p>
                ) : (
                  data.staffProductivity.map((s, i) => (
                    <div key={s.staffId} className="flex items-center gap-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${i === 0 ? "bg-amber-500" : i === 1 ? "bg-slate-400" : i === 2 ? "bg-amber-700" : "bg-slate-300"}`}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">
                          <StaffName name={s.staffName} active={s.staffActive} />
                        </p>
                        <p className="text-[10px] text-slate-400 capitalize">{s.staffRole}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-violet-600">{s.tasksCompleted}</p>
                        <p className="text-[10px] text-slate-400">{t("weeklyReport.tasks")}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-blue-500" />
                {t("weeklyReport.areaPerformance")}
              </h3>
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {data.areaPerformance.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">{t("weeklyReport.noActivity")}</p>
                ) : (
                  data.areaPerformance.map((a) => (
                    <div key={a.areaId}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-600 truncate">
                          {a.terminal} - {a.areaName}
                        </span>
                        <span className="text-xs text-slate-400 shrink-0 ml-2">
                          {a.completed}/{a.total}
                        </span>
                      </div>
                      <ProgressBar value={a.completed} max={a.total} color={a.completionRate >= 80 ? "emerald" : a.completionRate >= 50 ? "amber" : "rose"} />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <StaffBreakdownSection staffBreakdown={data.staffBreakdown ?? []} />
        </>
      )}
    </div>
  );
}
