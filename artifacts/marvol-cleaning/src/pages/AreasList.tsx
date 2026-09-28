import React from "react";
import { useListAreas } from "@workspace/api-client-react";
import { Link } from "wouter";
import { MapPin, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

const TERMINAL_HEADINGS: Record<string, string> = {
  "Terminal A - East": "Terminal A East",
  "Terminal A - West": "Terminal A West",
  "Terminal B - East": "Terminal B East",
  "Terminal B - West": "Terminal B West",
};

export default function AreasList() {
  const { t } = useTranslation();
  const { data: areas, isLoading } = useListAreas();

  if (isLoading) {
    return <div className="p-8 text-center text-slate-500 animate-pulse">{t("areas.loadingAreas")}</div>;
  }

  const groupedAreas = areas?.reduce((acc: any, area) => {
    if (!acc[area.terminal]) acc[area.terminal] = [];
    acc[area.terminal].push(area);
    return acc;
  }, {});
  const terminalEntries = groupedAreas ? Object.entries(groupedAreas) as [string, any[]][] : [];
  const terminalAnchor = (terminal: string) => `terminal-${terminal.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-display font-bold text-slate-900">{t("areas.cleaningZones")}</h1>
        <p className="text-slate-500 mt-2 font-medium">{t("areas.subtitle")}</p>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label={t("areas.cleaningZones")}>
        {terminalEntries.map(([terminal]) => (
          <a
            key={terminal}
            href={`#${terminalAnchor(terminal)}`}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
          >
            {TERMINAL_HEADINGS[terminal] ?? terminal}
          </a>
        ))}
      </nav>

      <div className="space-y-10">
        {terminalEntries.map(([terminal, terminalAreas]) => (
          <div key={terminal} id={terminalAnchor(terminal)} className="animate-fade-in-up scroll-mt-24">
            <div className="flex items-center gap-3 mb-4 border-b border-slate-200 pb-2">
              <MapPin className="w-5 h-5 text-accent" />
              <h2 className="text-xl font-display font-bold text-slate-800">
                {TERMINAL_HEADINGS[terminal] ?? terminal}
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {terminalAreas.map((area: any) => (
                <Link key={area.id} href={`/areas/${area.id}`}>
                  <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:shadow-md hover:border-accent hover:-translate-y-1 transition-all duration-200 group cursor-pointer flex items-start justify-between gap-4 h-full">
                    <div className="min-w-0">
                      <h3 className="font-bold text-lg text-slate-900 group-hover:text-accent transition-colors">{area.name}</h3>
                      <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                        <span className="font-semibold text-slate-700">Coverage:</span>{" "}
                        {area.coverage ?? area.location}
                      </p>
                      {area.additionalCoverage && (
                        <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
                          <span className="font-semibold text-slate-600">Additional coverage:</span>{" "}
                          {area.additionalCoverage}
                        </p>
                      )}
                    </div>
                    <div className="w-10 h-10 shrink-0 rounded-full bg-slate-50 flex items-center justify-center group-hover:bg-accent group-hover:text-white text-slate-400 transition-colors">
                      <ChevronRight className="w-5 h-5" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
