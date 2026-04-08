import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { getDateLocale } from "@/i18n/dateLocale";

type Props = {
  onRefresh: () => Promise<void> | void;
  lastUpdated?: Date | null;
  compact?: boolean;
};

export default function RefreshButton({ onRefresh, lastUpdated, compact }: Props) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateLocale(i18n.language);
  const [spinning, setSpinning] = useState(false);

  const handleClick = useCallback(async () => {
    setSpinning(true);
    try {
      await onRefresh();
    } finally {
      setTimeout(() => setSpinning(false), 600);
    }
  }, [onRefresh]);

  const timeLabel = lastUpdated
    ? formatDistanceToNow(lastUpdated, { addSuffix: true, locale: dateLocale })
    : null;

  if (compact) {
    return (
      <button
        onClick={handleClick}
        disabled={spinning}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 transition-all text-xs font-medium shadow-sm disabled:opacity-60"
        title={t("common.refresh")}
      >
        <RefreshCw className={`w-3.5 h-3.5 ${spinning ? "animate-spin" : ""}`} />
        {t("common.refresh")}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {timeLabel && (
        <span className="text-xs text-slate-400 hidden sm:inline">
          {t("common.lastUpdated", { time: timeLabel })}
        </span>
      )}
      <button
        onClick={handleClick}
        disabled={spinning}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 transition-all text-sm font-medium shadow-sm disabled:opacity-60"
      >
        <RefreshCw className={`w-4 h-4 ${spinning ? "animate-spin" : ""}`} />
        <span className="hidden sm:inline">{spinning ? t("common.refreshing") : t("common.refresh")}</span>
      </button>
    </div>
  );
}
