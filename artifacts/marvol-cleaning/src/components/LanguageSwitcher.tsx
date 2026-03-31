import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Globe, ChevronDown } from "lucide-react";
import { SUPPORTED_LANGUAGES } from "@/i18n";

interface LanguageSwitcherProps {
  variant?: "sidebar" | "login";
}

export function LanguageSwitcher({ variant = "sidebar" }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const baseLang = i18n.language?.split("-")[0]?.split("_")[0] ?? "en";
  const currentLang = SUPPORTED_LANGUAGES.find((l) => l.code === baseLang) ?? SUPPORTED_LANGUAGES[0];

  const handleChange = (code: string) => {
    i18n.changeLanguage(code);
    setOpen(false);
  };

  if (variant === "login") {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-emerald-200 text-sm font-medium transition-colors backdrop-blur-sm border border-white/10"
        >
          <Globe className="w-4 h-4" />
          <span>{currentLang.flag} {currentLang.label}</span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-40 bg-white rounded-xl border border-slate-200 shadow-xl z-50 overflow-hidden">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleChange(lang.code)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors hover:bg-slate-50 ${
                  baseLang === lang.code ? "bg-emerald-50 font-semibold text-emerald-700" : "text-slate-700"
                }`}
              >
                <span>{lang.flag}</span>
                <span>{lang.label}</span>
                {baseLang === lang.code && <span className="ml-auto text-emerald-500">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
      >
        <Globe className="w-5 h-5" />
        <span className="flex-1 text-left">{currentLang.flag} {currentLang.label}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-4 right-4 bottom-full mb-2 bg-sidebar-accent rounded-xl border border-sidebar-border/50 shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-sidebar-border/30 text-xs text-sidebar-foreground/50 font-medium">
            {t("layout.language")}
          </div>
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleChange(lang.code)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors hover:bg-sidebar-border/30 ${
                baseLang === lang.code ? "bg-sidebar-border/20 font-semibold text-sidebar-foreground" : "text-sidebar-foreground/70"
              }`}
            >
              <span>{lang.flag}</span>
              <span>{lang.label}</span>
              {baseLang === lang.code && <span className="ml-auto text-emerald-400">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
