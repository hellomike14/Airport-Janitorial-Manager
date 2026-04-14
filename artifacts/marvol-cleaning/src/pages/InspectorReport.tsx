import React, { useMemo, useRef } from "react";
import { format, subDays, parseISO } from "date-fns";
import { useTranslation } from "react-i18next";
import { getDateLocale } from "@/i18n/dateLocale";
import { useListIssues } from "@workspace/api-client-react";
import {
  Printer,
  Calendar,
  CheckCircle2,
  MapPin,
  User,
  FileText,
  Filter,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

const SEVERITY_STYLE = {
  high: { badge: "bg-red-100 text-red-700 border border-red-200", dot: "bg-red-500", color: "#dc2626" },
  medium: { badge: "bg-amber-100 text-amber-700 border border-amber-200", dot: "bg-amber-500", color: "#d97706" },
  low: { badge: "bg-slate-100 text-slate-600 border border-slate-200", dot: "bg-slate-400", color: "#64748b" },
};

function SeverityBadge({ severity }: { severity: string }) {
  const { t } = useTranslation();
  const s = SEVERITY_STYLE[severity as keyof typeof SEVERITY_STYLE] ?? SEVERITY_STYLE.low;
  const labelMap: Record<string, string> = { high: t("inspectorReport.high"), medium: t("inspectorReport.medium"), low: t("inspectorReport.low") };
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.badge}`}>{labelMap[severity] ?? severity}</span>;
}

function ReportStatusBadge({ resolved }: { resolved: boolean }) {
  const { t } = useTranslation();
  return resolved ? (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">{t("issues.resolved")}</span>
  ) : (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">{t("issues.open")}</span>
  );
}

function IssueImage({ path, label }: { path: string | null; label: string }) {
  if (!path) return null;
  const url = `${BASE_URL}/api/storage${path}`;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
      <img src={url} alt={label} className="w-28 h-20 object-cover rounded-xl border border-slate-200 shadow-sm"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
    </div>
  );
}

function buildIssuePDF(issue: any, t: (key: string, opts?: any) => string): string {
  const origin = window.location.origin;
  const logoUrl = `${origin}${BASE_URL}/logo.png`;
  const logoMarkUrl = `${origin}${BASE_URL}/logo-mark.png`;
  const beforeUrl = issue.beforeImagePath ? `${origin}${BASE_URL}/api/storage${issue.beforeImagePath}` : null;
  const afterUrl = issue.afterImagePath ? `${origin}${BASE_URL}/api/storage${issue.afterImagePath}` : null;

  const sev = SEVERITY_STYLE[issue.severity as keyof typeof SEVERITY_STYLE] ?? SEVERITY_STYLE.low;
  const generatedAt = format(new Date(), "MMMM d, yyyy 'at' h:mm a");
  const reportedDate = format(parseISO(issue.issueDate), "MMMM d, yyyy");
  const resolvedDate = issue.resolvedAt ? format(parseISO(issue.resolvedAt), "MMMM d, yyyy 'at' h:mm a") : null;

  const photosSection = (beforeUrl || afterUrl) ? `
    <div style="margin-top:24px;">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px;">${t("issuePdf.photos")}</div>
      <div style="display:flex;gap:20px;flex-wrap:wrap;">
        ${beforeUrl ? `<div>
          <div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">${t("issuePdf.before")}</div>
          <img src="${beforeUrl}" style="width:220px;height:155px;object-fit:cover;border-radius:10px;border:1px solid #e2e8f0;" onerror="this.style.display='none'" />
        </div>` : ''}
        ${afterUrl ? `<div>
          <div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">${t("issuePdf.after")}</div>
          <img src="${afterUrl}" style="width:220px;height:155px;object-fit:cover;border-radius:10px;border:1px solid #e2e8f0;" onerror="this.style.display='none'" />
        </div>` : ''}
      </div>
    </div>` : '';

  const completionSection = issue.completionNotes ? `
    <div style="margin-top:20px;background:#f8fafc;border-radius:10px;padding:14px 16px;border-left:3px solid #10b981;">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">${t("issuePdf.completionNotes")}</div>
      <div style="font-size:13px;color:#334155;line-height:1.6;">${issue.completionNotes}</div>
    </div>` : '';

  const resolvedSection = resolvedDate ? `
    <div style="margin-top:12px;display:flex;align-items:center;gap:8px;color:#059669;font-size:12px;font-weight:600;">
      <span style="width:8px;height:8px;background:#10b981;border-radius:50%;display:inline-block;"></span>
      ${t("issuePdf.resolvedOn", { date: resolvedDate })}
    </div>` : `
    <div style="margin-top:12px;display:flex;align-items:center;gap:8px;color:#2563eb;font-size:12px;font-weight:600;">
      <span style="width:8px;height:8px;background:#3b82f6;border-radius:50%;display:inline-block;"></span>
      ${t("issuePdf.statusOpenAwaiting")}
    </div>`;

  const severityDesc = issue.severity === 'high' ? t("issuePdf.urgentAttention") : issue.severity === 'medium' ? t("issuePdf.needsAttention") : t("issuePdf.routineIssue");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${t("issuePdf.issueReportTitle", { id: issue.id })}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f1f5f9; color: #1e293b; }
    .page { max-width: 720px; margin: 32px auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.10); }
    @media print {
      body { background: #fff; }
      .page { margin: 0; max-width: 100%; border-radius: 0; box-shadow: none; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="page">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#064e3b,#022c22);padding:28px 32px;display:flex;align-items:center;justify-content:space-between;gap:20px;">
      <div style="display:flex;align-items:center;gap:16px;">
        <img src="${logoMarkUrl}" style="width:52px;height:52px;object-fit:contain;" onerror="this.style.display='none'" />
        <div>
          <div style="background:rgba(255,255,255,0.95);border-radius:8px;padding:5px 12px;display:inline-block;margin-bottom:5px;">
            <img src="${logoUrl}" style="height:22px;object-fit:contain;" onerror="this.style.display='none'" />
          </div>
          <div style="color:#94a3b8;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">${t("issuePdf.facilityServices")}</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="color:#fff;font-weight:700;font-size:15px;letter-spacing:0.01em;">${t("issuePdf.issueReport")}</div>
        <div style="color:#64748b;font-size:11px;margin-top:3px;">${t("issuePdf.issueNumber", { id: issue.id })}</div>
        <div style="color:#475569;font-size:10px;margin-top:2px;">${t("issuePdf.generated", { date: generatedAt })}</div>
      </div>
    </div>

    <!-- Severity banner -->
    <div style="background:${sev.color}15;border-bottom:3px solid ${sev.color};padding:12px 32px;display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="background:${sev.color};color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;padding:3px 10px;border-radius:20px;">${t("issuePdf.priority", { level: sev.label })}</span>
        <span style="font-size:12px;font-weight:600;color:${sev.color};">${severityDesc}</span>
      </div>
      <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:${issue.resolved ? '#d1fae5' : '#dbeafe'};color:${issue.resolved ? '#065f46' : '#1d4ed8'};">${issue.resolved ? t("issuePdf.resolvedLabel") : t("issuePdf.openLabel")}</span>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px;">

      <!-- Location -->
      <div style="margin-bottom:20px;">
        <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">${t("issuePdf.location")}</div>
        ${issue.terminal ? `<div style="font-size:10px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.06em;">${issue.terminal}</div>` : ''}
        <div style="font-size:16px;font-weight:700;color:#1e293b;">${issue.areaName ?? t("issuePdf.unknownArea")}</div>
      </div>

      <!-- Divider -->
      <div style="height:1px;background:#f1f5f9;margin-bottom:20px;"></div>

      <!-- Description -->
      <div style="margin-bottom:20px;">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">${t("issuePdf.issueDescription")}</div>
        <div style="font-size:15px;color:#1e293b;line-height:1.6;font-weight:500;">${issue.description}</div>
      </div>

      <!-- Meta grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
        <div style="background:#f8fafc;border-radius:10px;padding:12px 14px;">
          <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">${t("issuePdf.dateReported")}</div>
          <div style="font-size:13px;color:#334155;font-weight:600;">${reportedDate}</div>
        </div>
        <div style="background:#f8fafc;border-radius:10px;padding:12px 14px;">
          <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">${t("issuePdf.reportedBy")}</div>
          <div style="font-size:13px;color:#334155;font-weight:600;">${issue.reportedByName ?? t("issuePdf.unknown")}</div>
        </div>
        ${issue.assignedToName ? `
        <div style="background:#eff6ff;border-radius:10px;padding:12px 14px;">
          <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">${t("issuePdf.assignedTo")}</div>
          <div style="font-size:13px;color:#1d4ed8;font-weight:600;">${issue.assignedToName}</div>
        </div>` : ''}
      </div>

      ${resolvedSection}
      ${completionSection}
      ${photosSection}

      <!-- Footer divider -->
      <div style="height:1px;background:#f1f5f9;margin-top:28px;margin-bottom:16px;"></div>

      <!-- Footer -->
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <img src="${logoMarkUrl}" style="width:24px;height:24px;object-fit:contain;opacity:0.5;" onerror="this.style.display='none'" />
          <span style="font-size:10px;color:#475569;">${t("issuePdf.confidentialRecord")}</span>
        </div>
        <span style="font-size:10px;color:#64748b;white-space:nowrap;">${t("issuePdf.issueNumber", { id: issue.id })}</span>
      </div>
    </div>
  </div>

  <script>
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 600);
    });
  </script>
</body>
</html>`;
}

function DownloadIssueButton({ issue }: { issue: any }) {
  const { t } = useTranslation();
  const handleDownload = () => {
    const html = buildIssuePDF(issue, t);
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
  };

  return (
    <button
      onClick={handleDownload}
      title={t("issuePdf.downloadPdf")}
      className="no-print flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-colors shrink-0"
    >
      <Download className="w-3.5 h-3.5" />
      PDF
    </button>
  );
}

export default function InspectorReport() {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateLocale(i18n.language);
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

  const handleApplyFilter = () => setFetchParams({ from, to });
  const handlePrint = () => window.print();

  const generatedAt = format(new Date(), "MMMM d, yyyy 'at' h:mm a");
  const fromLabel = format(parseISO(fetchParams.from), "MMMM d, yyyy");
  const toLabel = format(parseISO(fetchParams.to), "MMMM d, yyyy");

  return (
    <>
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

        {/* Page header */}
        <div className="no-print flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-slate-900 flex items-center gap-3">
              <FileText className="w-8 h-8 text-blue-600" />
              {t("inspectorReport.title")}
            </h1>
            <p className="text-slate-500 mt-1">{t("inspectorReport.subtitle")}</p>
          </div>
          <Button
            onClick={handlePrint}
            className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl shadow-md shadow-emerald-700/20 font-bold gap-2"
          >
            <Printer className="w-4 h-4" /> {t("inspectorReport.printFullSummary")}
          </Button>
        </div>

        {/* Date range filter */}
        <div className="no-print bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2 text-slate-500 font-medium">
            <Filter className="w-4 h-4" />
            <span className="text-sm">{t("inspectorReport.dateRange")}</span>
          </div>
          <div className="flex items-center gap-3 flex-1 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("inspectorReport.from")}</label>
              <input type="date" value={from} max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("inspectorReport.to")}</label>
              <input type="date" value={to} min={from} max={today}
                onChange={(e) => setTo(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30" />
            </div>
            <Button onClick={handleApplyFilter} variant="outline"
              className="rounded-xl border-slate-200 text-sm font-semibold mt-5">
              <Calendar className="w-4 h-4 mr-2" />
              {t("inspectorReport.apply")}
            </Button>
          </div>
        </div>

        {/* Printable report area */}
        <div id="inspector-report-print" ref={printRef} className="space-y-8">

          {/* Report header */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-900 to-emerald-950 px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div>
                  <div className="bg-white/95 rounded-xl px-3 py-1.5 inline-block mb-1">
                    <img src={`${BASE_URL}/logo.png`} alt="Marvol Enterprises" className="h-6 object-contain" />
                  </div>
                  <p className="text-emerald-200 text-xs font-semibold uppercase tracking-wider">Facility Services · MCO International Airport</p>
                </div>
                <img src={`${BASE_URL}/logo-mark.png`} alt="Marvol" className="w-12 h-12 object-contain" />
              </div>
              <div className="sm:text-right">
                <p className="text-white font-bold text-lg">Issue Summary Report</p>
                <p className="text-emerald-200 text-sm mt-0.5">{fromLabel} — {toLabel}</p>
                <p className="text-emerald-300/70 text-xs mt-1">Generated {generatedAt}</p>
              </div>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-3 md:grid-cols-6 divide-x divide-slate-100">
              {[
                { label: t("inspectorReport.totalIssues"), value: stats.total, color: "text-slate-800" },
                { label: t("issues.resolved"), value: stats.resolved, color: "text-emerald-600" },
                { label: t("issues.open"), value: stats.open, color: "text-blue-600" },
                { label: t("inspectorReport.high"), value: stats.high, color: "text-red-600" },
                { label: t("inspectorReport.medium"), value: stats.medium, color: "text-amber-600" },
                { label: t("inspectorReport.low"), value: stats.low, color: "text-slate-500" },
              ].map(({ label, value, color }) => (
                <div key={label} className="px-5 py-4 text-center">
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Loading */}
          {isLoading && (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-400 animate-pulse">
              {t("inspectorReport.loadingIssues")}
            </div>
          )}

          {/* No issues */}
          {!isLoading && issues.length === 0 && (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
              <p className="font-bold text-slate-700 text-lg">{t("inspectorReport.noIssuesFound")}</p>
              <p className="text-slate-400 text-sm mt-1">{t("inspectorReport.noIssuesBetween", { from: fromLabel, to: toLabel })}</p>
            </div>
          )}

          {/* Per-area breakdown */}
          {!isLoading && byArea.map(({ areaName, terminal, issues: areaIssues }, areaIdx) => {
            const resolved = areaIssues.filter((i) => i.resolved).length;
            const open = areaIssues.length - resolved;

            return (
              <div key={areaName}
                className={`bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden ${areaIdx > 0 ? "print-break" : ""}`}>

                {/* Area header */}
                <div className="bg-slate-50 border-b border-slate-100 px-6 py-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-700 flex items-center justify-center shrink-0">
                      <MapPin className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      {terminal && <p className="text-xs font-bold text-blue-600 uppercase tracking-wider">{terminal}</p>}
                      <h2 className="font-bold text-slate-900 text-base">{areaName}</h2>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium">
                    <span className="text-emerald-600">{resolved} {t("issues.resolved").toLowerCase()}</span>
                    <span className="text-slate-300 hidden sm:inline">·</span>
                    <span className="text-blue-600">{open} {t("issues.open").toLowerCase()}</span>
                    <span className="text-slate-300 hidden sm:inline">·</span>
                    <span className="text-slate-600">{areaIssues.length} {t("inspectorReport.total")}</span>
                  </div>
                </div>

                {/* Issues list */}
                <div className="divide-y divide-slate-50">
                  {areaIssues.map((issue) => (
                    <div key={issue.id} className="px-6 py-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${SEVERITY_STYLE[issue.severity as keyof typeof SEVERITY_STYLE]?.dot ?? "bg-slate-400"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1.5">
                              <span className="text-xs font-bold text-slate-400">#{issue.id}</span>
                              <SeverityBadge severity={issue.severity} />
                              <ReportStatusBadge resolved={issue.resolved} />
                            </div>
                            <p className="text-sm font-semibold text-slate-800 leading-snug">{issue.description}</p>
                          </div>
                        </div>

                        {/* Download PDF per issue */}
                        <DownloadIssueButton issue={issue} />
                      </div>

                      {/* Metadata */}
                      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {t("inspectorReport.reported")} {format(parseISO(issue.issueDate), "MMM d, yyyy", { locale: dateLocale })}
                        </span>
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {t("issues.by")} {issue.reportedByName}
                        </span>
                        {issue.assignedToName && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3 text-blue-400" />
                            {t("issues.assigned")} {issue.assignedToName}
                          </span>
                        )}
                        {issue.resolvedAt && (
                          <span className="flex items-center gap-1 text-emerald-600">
                            <CheckCircle2 className="w-3 h-3" />
                            {t("issues.resolved")} {format(parseISO(issue.resolvedAt), "MMM d, yyyy", { locale: dateLocale })}
                          </span>
                        )}
                      </div>

                      {/* Completion notes */}
                      {issue.completionNotes && (
                        <div className="mt-3 bg-slate-50 rounded-xl px-4 py-2.5 text-sm text-slate-700 border-l-2 border-emerald-400">
                          <span className="font-semibold text-slate-500 text-xs uppercase tracking-wide">{t("inspectorReport.whatWasDone")}: </span>
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
                <img src={`${BASE_URL}/logo-mark.png`} alt="Marvol" className="w-8 h-8 object-contain opacity-60" />
                <p className="text-xs text-slate-400">Marvol Facility Services · MCO International Airport · Internal Operations Report</p>
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
