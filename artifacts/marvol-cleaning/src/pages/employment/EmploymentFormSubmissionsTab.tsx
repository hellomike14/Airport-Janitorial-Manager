import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Download, FileText, Loader2, Mail, RefreshCw } from "lucide-react";
import {
  getGetEmploymentFormSubmissionQueryKey,
  getListEmploymentFormSubmissionsQueryKey,
  useGetEmploymentFormSubmission,
  useListEmploymentFormSubmissions,
  useResendEmploymentFormSubmissionEmail,
} from "@workspace/api-client-react";
import type { EmploymentFormId } from "./formEditor/formSources";
import { PdfDocumentActions } from "./PdfDocumentActions";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function formTitle(formId: EmploymentFormId, t: (key: string) => string) {
  const key = formId === "i-9" ? "i9" : formId === "w-4" ? "w4" : "jobApplication";
  return t(`employment.forms.${key}`);
}

function SubmissionDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useGetEmploymentFormSubmission(id);
  const resend = useResendEmploymentFormSubmissionEmail();
  const [notice, setNotice] = useState<"sent" | "failed" | null>(null);

  const retryEmail = async () => {
    setNotice(null);
    try {
      const result = await resend.mutateAsync({ id });
      setNotice(result.emailSent ? "sent" : "failed");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetEmploymentFormSubmissionQueryKey(id) }),
        queryClient.invalidateQueries({ queryKey: getListEmploymentFormSubmissionsQueryKey() }),
      ]);
    } catch {
      setNotice("failed");
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  }
  if (isError || !data) {
    return (
      <div>
        <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-1 text-sm text-slate-600">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t("common.back")}
        </button>
        <div role="alert" className="rounded-xl border border-red-200 bg-white p-5 text-sm text-red-800">
          {t("employment.submittedForms.loadError")}
        </div>
      </div>
    );
  }

  const fileUrl = (path: string) => `${BASE_URL}/api/storage${path}?download=1`;
  const canRetry = data.emailStatus !== "sent";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t("common.back")}
        </button>
        {canRetry && (
          <button type="button" onClick={retryEmail} disabled={resend.isPending}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {resend.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t("employment.submittedForms.retryEmail")}
          </button>
        )}
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{formTitle(data.formId, t)}</h2>
            <p className="mt-1 text-sm text-slate-700">{data.firstName} {data.lastName}</p>
            <p className="text-sm text-slate-500">{data.email}{data.phone ? ` · ${data.phone}` : ""}</p>
            <p className="mt-1 text-xs text-slate-500">{new Date(data.submittedAt).toLocaleString()}</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            data.emailStatus === "sent" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
          }`} data-testid="submission-email-status">
            {t(`employment.submittedForms.emailStatus.${data.emailStatus}`)}
          </span>
        </div>
        {notice && (
          <p role={notice === "sent" ? "status" : "alert"}
            className={`mt-4 rounded-lg px-3 py-2 text-sm ${notice === "sent" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
            {t(notice === "sent" ? "employment.submittedForms.retrySent" : "employment.submittedForms.retryFailed")}
          </p>
        )}
        <div className="mt-5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <a href={fileUrl(data.completedPdfPath)} className="flex min-h-[44px] min-w-[16rem] flex-1 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-50" data-testid="submitted-completed-pdf">
              <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{t("employment.submittedForms.completedPdf")}</span>
              <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
            </a>
            <PdfDocumentActions
              title={`${formTitle(data.formId, t)} — ${t("employment.submittedForms.completedPdf")}`}
              pdfUrl={`${BASE_URL}/api/storage${data.completedPdfPath}`}
              emailEndpoint={`${BASE_URL}/api/employment-form-submissions/${id}/email-pdf`}
              testId={`submitted-form-${id}-completed-pdf`}
            />
          </div>
          {data.idPhotos.map((photo, index) => (
            <a key={`${photo.path}-${index}`} href={fileUrl(photo.path)}
              className="flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-50">
              <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{photo.name}</span>
              <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

export function EmploymentFormSubmissionsTab() {
  const { t } = useTranslation();
  const { data: submissions, isLoading, isError } = useListEmploymentFormSubmissions();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  if (selectedId !== null) return <SubmissionDetail id={selectedId} onBack={() => setSelectedId(null)} />;
  return (
    <div className="space-y-6">
      <section aria-labelledby="submitted-forms-title" className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 id="submitted-forms-title" className="text-lg font-semibold text-slate-900">{t("employment.submittedForms.title")}</h2>
        <p className="mt-1 text-sm text-slate-500">{t("employment.submittedForms.subtitle")}</p>
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-500">
          <Mail className="h-3.5 w-3.5" aria-hidden="true" />{t("employment.forms.emailDestination", { address: "admin@marvolenterprises.com" })}
        </p>
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : isError ? (
          <p role="alert" className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{t("employment.submittedForms.loadError")}</p>
        ) : !submissions?.length ? (
          <p className="py-12 text-center text-sm text-slate-500">{t("employment.submittedForms.empty")}</p>
        ) : (
          <div className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {submissions.map((submission) => (
              <button key={submission.id} type="button" onClick={() => setSelectedId(submission.id)}
                className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-4 text-left hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-900">{submission.firstName} {submission.lastName}</span>
                  <span className="block truncate text-sm text-slate-500">
                    {formTitle(submission.formId, t)} · {submission.email} · {new Date(submission.submittedAt).toLocaleDateString()}
                  </span>
                </span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  submission.emailStatus === "sent" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
                }`}>
                  {t(`employment.submittedForms.emailStatus.${submission.emailStatus}`)}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
