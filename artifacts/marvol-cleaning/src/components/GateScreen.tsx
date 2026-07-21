import React, { useState, useRef, useEffect } from "react";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export function GateScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const { t } = useTranslation();
  const [digits, setDigits] = useState<string[]>(["", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const submit = async (pin: string) => {
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_URL}/api/gate/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        onUnlocked();
        return;
      }
      if (res.status === 429) {
        setError(t("gate.tooManyAttempts"));
      } else {
        setError(t("gate.incorrectCode"));
      }
      setDigits(["", "", "", ""]);
      inputRefs.current[0]?.focus();
    } catch {
      setError(t("gate.networkError"));
    } finally {
      setVerifying(false);
    }
  };

  const handleChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;
    const next = [...digits];
    next[index] = value;
    setDigits(next);
    setError(null);
    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }
    if (value && index === 3) {
      const pin = next.join("");
      if (pin.length === 4) submit(pin);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex flex-col items-center justify-center p-6">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm bg-white/95 backdrop-blur rounded-3xl shadow-2xl p-8 text-center">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-indigo-100 flex items-center justify-center mb-5">
          <Lock className="w-8 h-8 text-indigo-600" />
        </div>
        <h1 className="text-2xl font-display font-bold text-slate-900">{t("gate.title")}</h1>
        <p className="text-slate-500 mt-2 mb-6 text-sm">{t("gate.subtitle")}</p>
        <div className="flex justify-center gap-3 mb-4">
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={(el) => {
                inputRefs.current[i] = el;
              }}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={1}
              value={digit}
              disabled={verifying}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className="w-14 h-16 text-center text-2xl font-bold rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:outline-none bg-slate-50 disabled:opacity-50"
            />
          ))}
        </div>
        {error && <p className="text-rose-600 text-sm font-medium mb-2">{error}</p>}
        {verifying && <p className="text-slate-400 text-sm">{t("gate.checking")}</p>}
      </div>
      <p className="text-slate-400 text-xs mt-6 max-w-xs text-center">{t("gate.footer")}</p>
    </div>
  );
}
