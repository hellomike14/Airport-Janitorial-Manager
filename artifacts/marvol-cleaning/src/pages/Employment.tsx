import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, ClipboardCheck, Link2, Files, ShieldCheck } from "lucide-react";
import { ApplicationsTab } from "./employment/ApplicationsTab";
import { OnboardingTab } from "./employment/OnboardingTab";
import { QuickBooksTab } from "./employment/QuickBooksTab";
import { FormsTab } from "./employment/FormsTab";
import { useAuth } from "@/contexts/AuthContext";
import { ConfidentialBoundary } from "@/components/confidential/ConfidentialBoundary";
import { EmploymentFormSubmissionsTab } from "./employment/EmploymentFormSubmissionsTab";
import IdentityDocuments from "./employment/IdentityDocuments";

type Tab = "applications" | "onboarding" | "forms" | "submitted-forms" | "quickbooks";

function getInitialTab(): Tab {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  if (tab === "onboarding" || tab === "forms" || tab === "submitted-forms" || tab === "quickbooks") return tab;
  return "applications";
}

export default function Employment() {
  const { t } = useTranslation();
  const { effectiveRole } = useAuth();
  const allowedTabs: Tab[] = effectiveRole === "admin"
    ? ["applications", "onboarding", "forms", "submitted-forms", "quickbooks"]
    : effectiveRole ? ["onboarding", "forms"] : ["onboarding"];
  const [tab, setTab] = useState<Tab>(() => getInitialTab());
  const activeTab = allowedTabs.includes(tab) ? tab : "onboarding";

  useEffect(() => {
    document.title = t("employment.title");
  }, [t]);

  const navigateToTab = (nextTab: Tab) => {
    setTab(nextTab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", nextTab);
    window.history.replaceState(null, "", url);
  };

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "applications", label: t("employment.tabs.applications"), icon: FileText },
    { id: "onboarding", label: t("employment.tabs.onboarding"), icon: ClipboardCheck },
    { id: "forms", label: t("employment.tabs.forms"), icon: Files },
    { id: "submitted-forms", label: t("employment.tabs.submittedForms"), icon: ShieldCheck },
    { id: "quickbooks", label: t("employment.tabs.quickbooks"), icon: Link2 },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">{t("employment.title")}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t("employment.subtitle")}</p>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 mb-6">
        {tabs.filter(({ id }) => allowedTabs.includes(id)).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            data-testid={`employment-tab-${id}`}
            aria-pressed={activeTab === id}
            onClick={() => navigateToTab(id)}
            className={`flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === id
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {effectiveRole === "admin" && activeTab === "applications" && (
        <ConfidentialBoundary><ApplicationsTab /></ConfidentialBoundary>
      )}
      {activeTab === "onboarding" && <OnboardingTab onOpenForms={() => navigateToTab("forms")} />}
      {activeTab === "forms" && <FormsTab />}
      {effectiveRole === "admin" && activeTab === "submitted-forms" && (
        <ConfidentialBoundary>
          <div className="space-y-6">
            <EmploymentFormSubmissionsTab />
            <IdentityDocuments />
          </div>
        </ConfidentialBoundary>
      )}
      {effectiveRole === "admin" && activeTab === "quickbooks" && <QuickBooksTab />}
    </div>
  );
}
