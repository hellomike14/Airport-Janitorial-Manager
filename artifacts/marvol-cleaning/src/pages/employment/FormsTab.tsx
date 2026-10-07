import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { FileText, ExternalLink, Download, PenLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { ConfidentialBoundary } from "@/components/confidential/ConfidentialBoundary";
import IdentityDocuments from "./IdentityDocuments";
import type { EmploymentFormId } from "./formEditor/formSources";

const EmploymentFormEditor = lazy(() => import("./formEditor/EmploymentFormEditor"));

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const forms = [
  { id: "job-application", title: "jobApplication", description: "jobApplicationDescription" },
  { id: "i-9", title: "i9", description: "i9Description" },
  { id: "w-4", title: "w4", description: "w4Description" },
];

export function FormsTab() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [editing, setEditing] = useState<EmploymentFormId | null>(null);
  // Entries live only in the editor's memory; any identity change discards them.
  const identity = `${auth.currentUser?.id ?? ""}:${auth.effectiveRole}`;
  const lastIdentity = useRef(identity);
  useEffect(() => {
    if (lastIdentity.current !== identity) { lastIdentity.current = identity; setEditing(null); }
  }, [identity]);

  if (auth.effectiveRole !== "admin") return null;
  return (
    <ConfidentialBoundary>
    <div className="space-y-6">
    <section
      aria-labelledby="employment-forms-title"
      data-testid="employment-forms"
      className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"
    >
      <h2 id="employment-forms-title" className="text-lg font-semibold text-slate-900">
        {t("employment.tabs.forms")}
      </h2>
      {forms.map((form) => {
        const url = `${BASE_URL}/api/employment-forms/${form.id}`;
        return (
      <article key={form.id} className="mt-5 rounded-xl border border-slate-200 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <FileText className="h-8 w-8 shrink-0 text-emerald-600" aria-hidden="true" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-slate-800">{t(`employment.forms.${form.title}`)}</h3>
              <span data-testid={`fillable-${form.id}`}
                className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                {t("employment.forms.fillable")}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">{t(`employment.forms.${form.description}`)}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => setEditing(form.id as EmploymentFormId)}
            data-testid={`fill-online-${form.id}`}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            <PenLine className="h-4 w-4" aria-hidden="true" />
            {t("employment.forms.fillOnline")}
          </button>
          <a href={url} target="_blank" rel="noopener noreferrer"
            data-testid={`open-${form.id}`}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {t("employment.forms.open")}
          </a>
          <a href={`${url}?download=1`}
            data-testid={`download-${form.id}`}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Download className="h-4 w-4" aria-hidden="true" />
            {t("employment.forms.download")}
          </a>
        </div>
      </article>
        );
      })}
      <p className="mt-5 text-sm text-slate-500">{t("employment.forms.fillableHelp")}</p>
      {editing && (
        <Suspense fallback={null}>
          <EmploymentFormEditor key={`${identity}:${editing}`} formId={editing}
            title={t(`employment.forms.${forms.find((f) => f.id === editing)!.title}`)}
            onClose={() => setEditing(null)} />
        </Suspense>
      )}
    </section>
    <IdentityDocuments key={identity} />
    </div>
    </ConfidentialBoundary>
  );
}
