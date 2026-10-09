import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, ExternalLink, FileText, PenLine } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ConfidentialBoundary } from "@/components/confidential/ConfidentialBoundary";
import type { EmploymentFormId, EmploymentTemplateId } from "./formEditor/formSources";
import { onboardingForms, onboardingIndex } from "./onboardingFormCatalog";
import { PdfDocumentActions } from "./PdfDocumentActions";

const EmploymentFormEditor = lazy(() => import("./formEditor/EmploymentFormEditor"));
const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const FORM_EMAIL_RECIPIENT = "admin@marvolenterprises.com";
const promotedCandidateFormIds = new Set([
  "i-9",
  "w-4",
  "offer-acceptance",
  "emergency-contact",
  "language-accessibility",
  "orientation-acknowledgment",
  "video-attestation",
  "knowledge-check",
  "badge-rules-acknowledgment",
]);
type LibraryVariant = "employment" | "applicant" | "new-hire";
type CandidateIdentity = { firstName: string; lastName: string; email: string; phone: string | null };

type FormItem = {
  id: EmploymentTemplateId;
  title: string;
  description: string;
  fillable: boolean;
  restricted?: boolean;
};

const originalForms: FormItem[] = [
  { id: "job-application", title: "jobApplication", description: "jobApplicationDescription", fillable: true },
  { id: "i-9", title: "i9", description: "i9Description", fillable: true },
  { id: "w-4", title: "w4", description: "w4Description", fillable: true },
];
const companyForms: FormItem[] = onboardingForms.map(form => ({
  id: form.id,
  title: form.title,
  description: `${form.owner} · ${form.pages} pages · ${form.fieldCount} fillable fields`,
  fillable: true,
  restricted: form.restricted,
}));
const indexForm: FormItem = {
  id: onboardingIndex.id,
  title: onboardingIndex.title,
  description: `${onboardingIndex.pages}-page packet index`,
  fillable: false,
};

function FormCard({
  form,
  title,
  description,
  onFill,
  variant,
}: {
  form: FormItem;
  title: string;
  description: string;
  onFill: (id: EmploymentFormId) => void;
  variant: LibraryVariant;
}) {
  const { t } = useTranslation();
  const url = `${BASE_URL}/api/employment-forms/${form.id}`;
  return (
    <article data-testid={`form-card-${form.id}`} className="mt-5 rounded-xl border border-slate-200 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <FileText className="h-8 w-8 shrink-0 text-emerald-600" aria-hidden="true" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-800">{title}</h3>
            {form.fillable && (
              <span data-testid={`fillable-${form.id}`}
                className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                {t("employment.forms.fillable")}
              </span>
            )}
            {form.restricted && (
              <span data-testid={`restricted-${form.id}`}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                Admin only
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        {form.fillable && (
          <button type="button" onClick={() => onFill(form.id as EmploymentFormId)}
            data-testid={`fill-online-${form.id}`}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            <PenLine className="h-4 w-4" aria-hidden="true" />
            {t("employment.forms.fillOnline")}
          </button>
        )}
        {variant === "employment" && (
          <>
            <a href={url} target="_blank" rel="noopener noreferrer" data-testid={`open-${form.id}`}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              {t("employment.forms.open")}
            </a>
            <a href={`${url}?download=1`} data-testid={`download-${form.id}`}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Download className="h-4 w-4" aria-hidden="true" />
              {t("employment.forms.download")}
            </a>
            <PdfDocumentActions title={title} pdfUrl={url} emailEndpoint={`${url}/email`}
              testId={`blank-form-${form.id}`} />
          </>
        )}
      </div>
    </article>
  );
}

type Props = { variant?: LibraryVariant; candidate?: CandidateIdentity };

export function EmploymentFormsLibrary({ variant = "employment", candidate }: Props) {
  const { t } = useTranslation();
  const { effectiveRole } = useAuth();
  const [editing, setEditing] = useState<EmploymentFormId | null>(null);
  const [delivery, setDelivery] = useState<"sent" | "failed" | null>(null);
  const visibleForms = variant === "applicant"
    ? originalForms
    : variant === "new-hire"
      ? [
          ...originalForms.filter(form => form.id === "i-9" || form.id === "w-4"),
          ...companyForms.filter(form => promotedCandidateFormIds.has(form.id) && !form.restricted),
        ]
      : [...originalForms, ...companyForms.filter(form => !form.restricted)];
  const indexTitle = indexForm.title;

  return (
    <section
      aria-labelledby="employment-forms-title"
      data-testid="employment-forms"
      className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"
    >
      <h2 id="employment-forms-title" className="text-lg font-semibold text-slate-900">
        {t(variant === "applicant" ? "employment.apply.blankTemplates" : "employment.tabs.forms")}
      </h2>
      {variant === "employment" && (
        <p className="mt-2 text-sm text-slate-600">
          {t("employment.forms.emailDestination", { address: FORM_EMAIL_RECIPIENT })}
        </p>
      )}
      {delivery && (
        <p role={delivery === "failed" ? "alert" : "status"}
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${delivery === "sent" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
          {t(delivery === "sent" ? "employment.forms.submissionSent" : "employment.forms.submissionEmailFailed")}
        </p>
      )}
      {visibleForms.map(form => {
        const title = ["job-application", "i-9", "w-4"].includes(form.id)
          ? t(`employment.forms.${form.title}`)
          : form.title;
        const description = ["job-application", "i-9", "w-4"].includes(form.id)
          ? t(`employment.forms.${form.description}`)
          : form.description;
        return (
          <FormCard key={form.id} form={form} title={title} description={description} variant={variant}
            onFill={id => { setDelivery(null); setEditing(id); }} />
        );
      })}
      {variant === "employment" && effectiveRole === "admin" && (
        <section className="mt-8 border-t border-slate-200 pt-4" aria-labelledby="restricted-forms-title">
          <h3 id="restricted-forms-title" className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Admin-only onboarding templates
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            These seven blank PDFs contain assessor or administrative material. Access is protected by the confidential Admin boundary.
          </p>
          <ConfidentialBoundary>
            {companyForms.filter(form => form.restricted).map(form => (
              <FormCard key={form.id} form={form} title={form.title} description={form.description} variant={variant}
                onFill={id => { setDelivery(null); setEditing(id); }} />
            ))}
          </ConfidentialBoundary>
        </section>
      )}
      {variant === "employment" && <section className="mt-8 border-t border-slate-200 pt-4" aria-labelledby="onboarding-index-title">
        <h3 id="onboarding-index-title" className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          Packet index
        </h3>
        <FormCard form={indexForm} title={indexTitle} description={indexForm.description} variant={variant}
          onFill={() => {}} />
      </section>}
      <p className="mt-5 text-sm text-slate-500">{t("employment.forms.fillableHelp")}</p>
      {editing && (
        <Suspense fallback={null}>
          <EmploymentFormEditor
            key={editing}
            formId={editing}
            title={originalForms.some(form => form.id === editing)
              ? t(`employment.forms.${originalForms.find(form => form.id === editing)!.title}`)
              : companyForms.find(form => form.id === editing)!.title}
            allowExport={variant !== "applicant"}
            showDestination={variant === "employment"}
            candidate={variant === "new-hire" ? candidate : undefined}
            onClose={() => setEditing(null)}
            onSubmitted={(emailSent) => {
              setEditing(null);
              setDelivery(emailSent ? "sent" : "failed");
            }}
          />
        </Suspense>
      )}
    </section>
  );
}
