import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Loader2, Printer, Save, FileText } from "lucide-react";
import {
  useListApplications,
  useGetApplication,
  useUpdateApplication,
  getListApplicationsQueryKey,
  getGetApplicationQueryKey,
} from "@workspace/api-client-react";
import type { JobApplication, UpdateApplicationRequestStatus } from "@workspace/api-client-react";
import { EMPLOYER_SECTIONS, PUBLIC_SECTIONS } from "./formConfig";
import { FieldGrid } from "./FormField";
import { buildApplicationPDF } from "./applicationPdf";

const STATUSES: UpdateApplicationRequestStatus[] = ["new", "reviewing", "hired", "rejected"];

const STATUS_STYLE: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  reviewing: "bg-amber-100 text-amber-700",
  hired: "bg-emerald-100 text-emerald-700",
  rejected: "bg-slate-200 text-slate-600",
};

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[status] ?? STATUS_STYLE.new}`}>
      {t(`employment.status.${status}`)}
    </span>
  );
}

function ApplicationDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: app, isLoading } = useGetApplication(id);
  const update = useUpdateApplication();

  const [status, setStatus] = useState<UpdateApplicationRequestStatus>("new");
  const [groups, setGroups] = useState<Record<string, Record<string, unknown>>>({
    i9Employer: {},
    w4Employer: {},
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (app) {
      setStatus(app.status as UpdateApplicationRequestStatus);
      setGroups({
        i9Employer: (app.i9Employer as Record<string, unknown>) ?? {},
        w4Employer: (app.w4Employer as Record<string, unknown>) ?? {},
      });
    }
  }, [app]);

  const setField = (group: string) => (key: string, value: unknown) =>
    setGroups((prev) => ({ ...prev, [group]: { ...prev[group], [key]: value } }));

  const handleSave = async () => {
    await update.mutateAsync({
      id,
      data: { status, i9Employer: groups.i9Employer, w4Employer: groups.w4Employer },
    });
    await queryClient.invalidateQueries({ queryKey: getGetApplicationQueryKey(id) });
    await queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handlePrint = () => {
    if (!app) return;
    const merged: JobApplication = {
      ...app,
      status,
      i9Employer: groups.i9Employer,
      w4Employer: groups.w4Employer,
    };
    const html = buildApplicationPDF(merged, t);
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
  };

  if (isLoading || !app) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft className="w-4 h-4" />
          {t("common.back")}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            <Printer className="w-4 h-4" />
            {t("employment.detail.printPdf")}
          </button>
          <button
            onClick={handleSave}
            disabled={update.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {update.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saved ? t("employment.detail.saved") : t("common.save")}
          </button>
        </div>
      </div>

      {/* Applicant header */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {app.firstName} {app.lastName}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {app.positionApplied || t("employment.detail.noPosition")}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-slate-600">
              {app.email && <span>{app.email}</span>}
              {app.phone && <span>{app.phone}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <label className="text-xs font-medium text-slate-600">{t("employment.detail.status")}</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as UpdateApplicationRequestStatus)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`employment.status.${s}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Read-only applicant-submitted sections */}
      {PUBLIC_SECTIONS.map((section) => {
        const data = (app[section.group as keyof JobApplication] as Record<string, unknown>) ?? {};
        const entries = section.fields.filter((f) => {
          const v = data[f.key];
          return v !== undefined && v !== null && v !== "";
        });
        if (entries.length === 0) return null;
        return (
          <div key={section.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-base font-semibold text-slate-900 mb-4">
              {t(`employment.sections.${section.id}`)}
            </h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              {entries.map((f) => (
                <div key={f.key}>
                  <dt className="text-xs font-medium text-slate-500">
                    {t(`employment.fields.${f.key}`)}
                  </dt>
                  <dd className="text-sm text-slate-800 mt-0.5">
                    {f.type === "checkbox"
                      ? data[f.key]
                        ? t("common.yes")
                        : t("common.no")
                      : f.type === "select"
                        ? t(`employment.options.${f.key}.${data[f.key]}`, { defaultValue: String(data[f.key]) })
                        : String(data[f.key])}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}

      {/* Documents */}
      {app.documents && app.documents.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-base font-semibold text-slate-900 mb-4">
            {t("employment.sections.documents")}
          </h3>
          <ul className="space-y-2">
            {app.documents.map((doc, i) => (
              <li key={`${doc.path}-${i}`}>
                <a
                  href={`${import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""}/api/storage${doc.path}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-emerald-700 hover:underline"
                >
                  <FileText className="w-4 h-4" />
                  {doc.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Employer-editable sections */}
      {EMPLOYER_SECTIONS.map((section) => (
        <div key={section.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-base font-semibold text-slate-900 mb-1">
            {t(`employment.sections.${section.id}`)}
          </h3>
          <p className="text-xs text-slate-500 mb-4">{t(`employment.sections.${section.id}Desc`)}</p>
          <FieldGrid
            fields={section.fields}
            values={groups[section.group]}
            onChange={setField(section.group)}
          />
        </div>
      ))}
    </div>
  );
}

export function ApplicationsTab() {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { data: applications, isLoading } = useListApplications(
    statusFilter === "all" ? undefined : { status: statusFilter as UpdateApplicationRequestStatus },
  );

  if (selectedId !== null) {
    return <ApplicationDetail id={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {(["all", ...STATUSES] as string[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
              statusFilter === s
                ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {s === "all" ? t("common.all") : t(`employment.status.${s}`)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
        </div>
      ) : !applications || applications.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">{t("employment.applications.empty")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden divide-y divide-slate-100">
          {applications.map((app) => (
            <button
              key={app.id}
              onClick={() => setSelectedId(app.id)}
              className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
            >
              <div className="min-w-0">
                <div className="font-medium text-slate-900 truncate">
                  {app.firstName} {app.lastName}
                </div>
                <div className="text-sm text-slate-500 truncate">
                  {app.positionApplied || t("employment.detail.noPosition")}
                  {app.email ? ` · ${app.email}` : ""}
                </div>
              </div>
              <StatusBadge status={app.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
