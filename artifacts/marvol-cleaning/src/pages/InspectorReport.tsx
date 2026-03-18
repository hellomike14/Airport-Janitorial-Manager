import React, { useMemo, useRef } from "react";
import { format, subDays, parseISO } from "date-fns";
import { useListIssues } from "@workspace/api-client-react";
import {
  Printer,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  MapPin,
  User,
  FileText,
  BarChart3,
  ChevronDown,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const SEVERITY_STYLE = {
  high: { badge: "bg-red-100 text-red-700 border border-red-200", dot: "bg-red-500", label: "High" },
  medium: { badge: "bg-amber-100 text-amber-700 border border-amber-200", dot: "bg-amber-500", label: "Medium" },
  low: { badge: "bg-slate-100 text-slate-600 border border-slate-200", dot: "bg-slate-400", label: "Low" },
};

function SeverityBadge({ severity }: { severity: string }) {
  const s = SEVERITY_STYLE[severity as keyof typeof SEVERITY_STYLE] ?? SEVERITY_STYLE.low;
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.badge}`}>
      {s.label}
    </span>
  );
}

function StatusBadge({ resolved }: { resolved: boolean }) {
  return resolved ? (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">Resolved</span>
  ) : (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">Open</span>
  );
}

function IssueImage({ path, label }: { path: string | null; label: string }) {
  if (!path) return null;
  const url = `${import.meta.env.BASE_URL}api/storage${path}`;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
      <img
        src={url}
        alt={label}
        className="w-28 h-20 object-cover rounded-xl border border-slate-200 shadow-sm"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    </div>
  );
}

export default function InspectorReport() {
  const today = format(new Date(), "yyyy-MM-dd");
  const sevenDaysAgo = format(subDays(new Date(), 7), "yyyy-MM-dd");

  const [from, setFrom] = React.useState(sevenDaysAgo);
  const [to, setTo] = React.useState(today);
  const [fetchParams, setFetchParams] = React.useState({ from: sevenDaysAgo, to: today });
  const printRef = useRef<HTMLDivElement>(null);

  const { data: issues = [], isLoading } = useListIssues({
    from: fetchParams.from,
    to: fetchParams.to,
  });

  const stats = useMemo(() => {
    const total = issues.length;
    const resolved = issues.filter((i) => i.resolved).length;
    const open = total - resolved;
    const high = issues.filter((i) => i.severity === "high").length;
    const medium = issues.filter((i) => i.severity === "medium").length;
    const low = issues.filter((i) => i.severity === "low").length;
    return { total, resolved, open, high, medium, low };
  }, [issues]);

  const byArea = useMemo(() => {
    const map = new Map<string, { areaName: string; terminal: string; issues: typeof issues }>();
    for (const issue of issues) {
      const key = String(issue.areaId);
      if (!map.has(key)) {
        map.set(key, { areaName: issue.areaName ?? "", terminal: (issue as any).terminal ?? "", issues: [] });
      }
      map.get(key)!.issues.push(issue);
    }
    return Array.from(map.values()).sort((a, b) => a.areaName.localeCompare(b.areaName));
  }, [issues]);

  const handleApplyFilter = () => {
    setFetchParams({ from, to });
  };

  const handlePrint = () => {
    window.print();
  };

  const generatedAt = format(new Date(), "MMMM d, yyyy 'at' h:mm a");
  const fromLabel = format(parseISO(fetchParams.from), "MMMM d, yyyy");
  const toLabel = format(parseISO(fetchParams.to), "MMMM d, yyyy");

  return (
    <>
      {/* Print-only global styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #inspector-report-print, #inspector-report-print * { visibility: visible; }
          #inspector-report-print { position: fixed; inset: 0; }
          .no-print { display: none !important; }
          .print-break { page-break-before: always; }
        }
      `}</style>

      <div className="max-w-5xl mx-auto pb-16 space-y-8">

        {/* Page header — screen only */}
        <div className="no-print flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-slate-900 flex items-center gap-3">
              <FileText className="w-8 h-8 text-blue-600" />
              Inspector Report
            </h1>
            <p className="text-slate-500 mt-1">Generate a summary report for airport inspection authorities.</p>
          </div>
          <Button
            onClick={handlePrint}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md shadow-blue-600/20 font-bold gap-2"
          >
            <Printer className="w-4 h-4" /> Print / Save PDF
          </Button>
        </div>

        {/* Date range filter — screen only */}
        <div className="no-print bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2 text-slate-500 font-medium">
            <Filter className="w-4 h-4" />
            <span className="text-sm">Date Range</span>
          </div>
          <div className="flex items-center gap-3 flex-1 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">From</label>
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">To</label>
              <input
                type="date"
                value={to}
                min={from}
                max={today}
                onChange={(e) => setTo(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30"
              />
            </div>
            <Button
              onClick={handleApplyFilter}
              variant="outline"
              className="rounded-xl border-slate-200 text-sm font-semibold mt-5"
            >
              <Calendar className="w-4 h-4 mr-2" />
              Apply
            </Button>
          </div>
        </div>

        {/* ======================================================= */}
        {/* PRINTABLE REPORT AREA                                    */}
        {/* ======================================================= */}
        <div id="inspector-report-print" ref={printRef} className="space-y-8">

          {/* Report header */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-8 py-6 flex items-center justify-between gap-6">
              <div className="flex items-center gap-5">
                <img
                  src={`${import.meta.env.BASE_URL}logo-mark.png`}
                  alt="Marvol"
                  className="w-14 h-14 object-contain"
                />
                <div>
                  <div className="bg-white/95 rounded-xl px-4 py-1.5 inline-block mb-1">
                    <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Marvol Enterprises" className="h-7 object-contain" />
                  </div>
                  <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Facility Services · MCO International Airport</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-white font-bold text-lg">Issue Summary Report</p>
                <p className="text-slate-400 text-sm mt-0.5">{fromLabel} — {toLabel}</p>
                <p className="text-slate-500 text-xs mt-1">Generated {generatedAt}</p>
              </div>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-3 md:grid-cols-6 divide-x divide-slate-100">
              {[
                { label: "Total Issues", value: stats.total, color: "text-slate-800" },
                { label: "Resolved", value: stats.resolved, color: "text-emerald-600" },
                { label: "Open", value: stats.open, color: "text-blue-600" },
                { label: "High", value: stats.high, color: "text-red-600" },
                { label: "Medium", value: stats.medium, color: "text-amber-600" },
                { label: "Low", value: stats.low, color: "text-slate-500" },
              ].map(({ label, value, color }) => (
                <div key={label} className="px-5 py-4 text-center">
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Loading state */}
          {isLoading && (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-400 animate-pulse">
              Loading issues for report...
            </div>
          )}

          {/* No issues */}
          {!isLoading && issues.length === 0 && (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
              <p className="font-bold text-slate-700 text-lg">No Issues Found</p>
              <p className="text-slate-400 text-sm mt-1">No issues were reported between {fromLabel} and {toLabel}.</p>
            </div>
          )}

          {/* Per-area breakdown */}
          {!isLoading && byArea.map(({ areaName, terminal, issues: areaIssues }, areaIdx) => {
            const resolved = areaIssues.filter((i) => i.resolved).length;
            const open = areaIssues.length - resolved;

            return (
              <div
                key={areaName}
                className={`bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden ${areaIdx > 0 ? "print-break" : ""}`}
              >
                {/* Area header */}
                <div className="bg-slate-50 border-b border-slate-100 px-6 py-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
                      <MapPin className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      {terminal && (
                        <p className="text-xs font-bold text-blue-600 uppercase tracking-wider">{terminal}</p>
                      )}
                      <h2 className="font-bold text-slate-900 text-base">{areaName}</h2>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm font-medium">
                    <span className="text-emerald-600">{resolved} resolved</span>
                    <span className="text-slate-300">·</span>
                    <span className="text-blue-600">{open} open</span>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-600">{areaIssues.length} total</span>
                  </div>
                </div>

                {/* Issues list */}
                <div className="divide-y divide-slate-50">
                  {areaIssues.map((issue, idx) => (
                    <div key={issue.id} className="px-6 py-5">
                      {/* Issue row top */}
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${SEVERITY_STYLE[issue.severity as keyof typeof SEVERITY_STYLE]?.dot ?? "bg-slate-400"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1.5">
                              <span className="text-xs font-bold text-slate-400">#{issue.id}</span>
                              <SeverityBadge severity={issue.severity} />
                              <StatusBadge resolved={issue.resolved} />
                            </div>
                            <p className="text-sm font-semibold text-slate-800 leading-snug">{issue.description}</p>
                          </div>
                        </div>
                      </div>

                      {/* Issue metadata */}
                      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Reported {format(parseISO(issue.issueDate), "MMM d, yyyy")}
                        </span>
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          By {issue.reportedByName}
                        </span>
                        {issue.assignedToName && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3 text-blue-400" />
                            Assigned to {issue.assignedToName}
                          </span>
                        )}
                        {issue.resolvedAt && (
                          <span className="flex items-center gap-1 text-emerald-600">
                            <CheckCircle2 className="w-3 h-3" />
                            Resolved {format(parseISO(issue.resolvedAt), "MMM d, yyyy 'at' h:mm a")}
                          </span>
                        )}
                      </div>

                      {/* Completion notes */}
                      {issue.completionNotes && (
                        <div className="mt-3 bg-slate-50 rounded-xl px-4 py-2.5 text-sm text-slate-700">
                          <span className="font-semibold text-slate-500 text-xs uppercase tracking-wide">Completion Notes: </span>
                          {issue.completionNotes}
                        </div>
                      )}

                      {/* Before / After photos */}
                      {(issue.beforeImagePath || issue.afterImagePath) && (
                        <div className="mt-3 flex gap-4">
                          <IssueImage path={issue.beforeImagePath ?? null} label="Before" />
                          <IssueImage path={issue.afterImagePath ?? null} label="After" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Report footer */}
          {!isLoading && issues.length > 0 && (
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm px-8 py-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <img
                  src={`${import.meta.env.BASE_URL}logo-mark.png`}
                  alt="Marvol"
                  className="w-8 h-8 object-contain opacity-60"
                />
                <p className="text-xs text-slate-400">
                  Marvol Facility Services · MCO International Airport · Internal Operations Report
                </p>
              </div>
              <p className="text-xs text-slate-400 shrink-0">
                {issues.length} issue{issues.length !== 1 ? "s" : ""} · {fromLabel} – {toLabel}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
