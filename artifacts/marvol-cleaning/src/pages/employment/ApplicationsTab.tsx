import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Download, Loader2, Save, FileText, Mail, RefreshCw, UserRoundCheck } from "lucide-react";
import {
  useListApplications,
  useGetApplication,
  useUpdateApplication,
  useResendApplicationEmail,
  getListApplicationsQueryKey,
  getGetApplicationQueryKey,
} from "@workspace/api-client-react";
import type { JobApplication, UpdateApplicationRequestStatus } from "@workspace/api-client-react";
import { EMPLOYER_SECTIONS, PUBLIC_SECTIONS } from "./formConfig";
import { FieldGrid } from "./FormField";
import { PdfDocumentActions } from "./PdfDocumentActions";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
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
  const resendEmail = useResendApplicationEmail();

  const [status, setStatus] = useState<UpdateApplicationRequestStatus>("new");
  const [groups, setGroups] = useState<Record<string, Record<string, unknown>>>({
    i9Employer: {},
    w4Employer: {},
  });
  const [saved, setSaved] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [promotedHireId, setPromotedHireId] = useState<number | null>(null);
  const [promotionError, setPromotionError] = useState<string | null>(null);
  const [emailNotice, setEmailNotice] = useState<"sent" | "failed" | null>(null);
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

  const handleResendEmail = async () => {
    setEmailNotice(null);
    try {
      const result = await resendEmail.mutateAsync({ id });
      setEmailNotice(result.emailSent ? "sent" : "failed");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetApplicationQueryKey(id) }),
        queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey() }),
      ]);
    } catch {
      setEmailNotice("failed");
    }
  };

  const handlePromote = async () => {
    setPromoting(true);
    setPromotionError(null);
    try {
      const response = await fetch(`${BASE_URL}/api/onboarding/applications/${id}/promote`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error("Promotion failed");
      const result = await response.json() as { hireId: number };
      setPromotedHireId(result.hireId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetApplicationQueryKey(id) }),
        queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey() }),
      ]);
    } catch {
      setPromotionError("Could not promote this application. Check that it has a valid email and is not rejected.");
    } finally {
      setPromoting(false);
    }
  };

  if (isLoading || !app) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  const hasUnsavedPdfChanges = status !== app.status ||
    JSON.stringify(groups.i9Employer) !== JSON.stringify((app.i9Employer as Record<string, unknown>) ?? {}) ||
    JSON.stringify(groups.w4Employer) !== JSON.stringify((app.w4Employer as Record<string, unknown>) ?? {});
  const pdfUrl = `${import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""}/api/applications/${id}/pdf`;

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
          {app.emailStatus !== "sent" && (
            <button type="button" onClick={handleResendEmail} disabled={resendEmail.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              {resendEmail.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t("employment.applications.retryEmail")}
            </button>
          )}
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
      {hasUnsavedPdfChanges ? (
        <p role="status" data-testid="application-pdf-save-required"
          className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t("employment.detail.saveBeforePdf")}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <PdfDocumentActions
            title={`${app.firstName} ${app.lastName} — ${t("employment.sections.application")}`}
            pdfUrl={pdfUrl}
            emailEndpoint={`${pdfUrl.replace(/\/pdf$/, "/email-pdf")}`}
            testId={`application-${id}-pdf`}
          />
          <a href={pdfUrl} download="Marvol_Employment_Application.pdf"
            data-testid={`application-${id}-pdf-download`}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Download className="h-4 w-4" aria-hidden="true" />
            {t("employment.forms.download")}
          </a>
        </div>
      )}
      {emailNotice && (
        <p role={emailNotice === "sent" ? "status" : "alert"}
          className={`rounded-lg px-3 py-2 text-sm ${emailNotice === "sent" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
          {t(emailNotice === "sent" ? "employment.submittedForms.retrySent" : "employment.submittedForms.retryFailed")}
        </p>
      )}
      {promotionError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{promotionError}</p>}

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
            {promotedHireId !== null ? (
              <p role="status" className="text-xs font-medium text-emerald-700">Linked New Hire #{promotedHireId}</p>
            ) : app.status !== "rejected" ? (
              <button type="button" onClick={handlePromote} disabled={promoting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 disabled:opacity-50">
                {promoting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundCheck className="h-4 w-4" />}
                {app.status === "hired" ? "Link New Hire" : "Promote to New Hire"}
              </button>
            ) : null}
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
            {app.documents.map((doc, i) => {
              const documentUrl = `${import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""}/api/storage${doc.path}`;
              const isPdf = doc.contentType === "application/pdf" || /\.pdf$/i.test(doc.name);
              return (
                <li key={`${doc.path}-${i}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <a
                      href={documentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center gap-2 text-sm text-emerald-700 hover:underline"
                    >
                      <FileText className="w-4 h-4" />
                      {doc.name}
                    </a>
                    {isPdf && (
                      <PdfDocumentActions
                        title={doc.name}
                        pdfUrl={documentUrl}
                        emailEndpoint={`${import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""}/api/applications/${id}/documents/${i}/email`}
                        testId={`application-${id}-document-${i}`}
                      />
                    )}
                  </div>
                </li>
              );
            })}
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
              <div className="flex shrink-0 flex-col items-end gap-1">
                <StatusBadge status={app.status} />
                <span className={`text-[11px] font-medium ${
                  app.emailStatus === "sent" ? "text-emerald-700" : "text-amber-700"
                }`}>
                  {t(`employment.applications.emailStatus.${app.emailStatus ?? "notSent"}`)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
