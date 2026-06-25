import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, ClipboardCheck, Link2 } from "lucide-react";
import { ApplicationsTab } from "./employment/ApplicationsTab";
import { OnboardingTab } from "./employment/OnboardingTab";
import { QuickBooksTab } from "./employment/QuickBooksTab";

type Tab = "applications" | "onboarding" | "quickbooks";

function getInitialTab(): Tab {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  if (tab === "onboarding" || tab === "quickbooks") return tab;
  return "applications";
}

export default function Employment() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>(getInitialTab);

  useEffect(() => {
    document.title = t("employment.title");
  }, [t]);

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "applications", label: t("employment.tabs.applications"), icon: FileText },
    { id: "onboarding", label: t("employment.tabs.onboarding"), icon: ClipboardCheck },
    { id: "quickbooks", label: t("employment.tabs.quickbooks"), icon: Link2 },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">{t("employment.title")}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t("employment.subtitle")}</p>
      </div>

      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "applications" && <ApplicationsTab />}
      {tab === "onboarding" && <OnboardingTab />}
      {tab === "quickbooks" && <QuickBooksTab />}
    </div>
  );
}
