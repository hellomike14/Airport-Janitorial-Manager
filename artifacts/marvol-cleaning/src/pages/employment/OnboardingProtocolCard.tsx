import { FileText, ExternalLink, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { OnboardingProtocolActions } from "./OnboardingProtocolActions";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export function OnboardingProtocolCard() {
  const { t } = useTranslation();
  const url = `${BASE_URL}/api/onboarding-protocol`;
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
      <OnboardingProtocolActions protectedUrl={url} />
    </section>
  );
}
