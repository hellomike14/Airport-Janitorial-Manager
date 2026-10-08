import { FileText, ExternalLink, Download, Files } from "lucide-react";
import { useTranslation } from "react-i18next";
import { OnboardingProtocolActions } from "./OnboardingProtocolActions";
import { PdfDocumentActions } from "./PdfDocumentActions";
import { onboardingIndex } from "./onboardingFormCatalog";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export function OnboardingProtocolCard({
  canEmailProtocol = false,
  onOpenForms,
}: {
  canEmailProtocol?: boolean;
  onOpenForms?: () => void;
}) {
  const { t } = useTranslation();
  const url = `${BASE_URL}/api/onboarding-protocol`;
  const formsIndexUrl = `${BASE_URL}/api/employment-forms/${onboardingIndex.id}`;
  return (
    <section aria-labelledby="onboarding-protocol-title" data-testid="onboarding-protocol"
      className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <FileText className="h-9 w-9 shrink-0 text-emerald-600" aria-hidden="true" />
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t("employment.onboarding.protocol.label")}
          </div>
          <h3 id="onboarding-protocol-title" className="font-semibold text-slate-900">
            {t("employment.onboarding.protocol.title")}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span>{t("employment.onboarding.protocol.version")}</span>
            <span aria-hidden="true">·</span>
            <span>{t("employment.onboarding.protocol.prepared")}</span>
          </div>
          <span data-testid="onboarding-protocol-status"
            className="mt-2 inline-block rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
            {t("employment.onboarding.protocol.status")}
          </span>
          <p className="mt-2 text-sm text-slate-500">{t("employment.onboarding.protocol.note")}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <a href={url} target="_blank" rel="noopener noreferrer" data-testid="open-onboarding-protocol"
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          {t("employment.onboarding.protocol.view")}
        </a>
        <a href={`${url}?download=1`} data-testid="download-onboarding-protocol"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          <Download className="h-4 w-4" aria-hidden="true" />
          {t("employment.onboarding.protocol.download")}
        </a>
      </div>
      <OnboardingProtocolActions protectedUrl={url} canEmailProtocol={canEmailProtocol} />
      <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
        <div className="flex items-start gap-3">
          <Files className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
          <div>
            <h4 className="font-semibold text-slate-900">
              {t("employment.onboarding.formsPacket.title", { defaultValue: "Onboarding forms packet" })}
            </h4>
            <p className="mt-1 text-sm text-slate-600">
              {t("employment.onboarding.formsPacket.description", {
                defaultValue: "Open the three-page index, email it, print it, or download it to your computer. The Forms tab contains the individual fillable PDFs.",
              })}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <a href={formsIndexUrl} target="_blank" rel="noopener noreferrer" data-testid="open-onboarding-forms-index"
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {t("employment.onboarding.protocol.view")}
          </a>
          <a href={`${formsIndexUrl}?download=1`} data-testid="download-onboarding-forms-index"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Download className="h-4 w-4" aria-hidden="true" />
            {t("employment.onboarding.protocol.download")}
          </a>
          <PdfDocumentActions
            title={onboardingIndex.title}
            pdfUrl={formsIndexUrl}
            emailEndpoint={`${formsIndexUrl}/email`}
            testId="onboarding-forms-index"
          />
          {onOpenForms && (
            <button type="button" onClick={onOpenForms} data-testid="browse-onboarding-forms"
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50">
              <Files className="h-4 w-4" aria-hidden="true" />
              {t("employment.tabs.forms")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
