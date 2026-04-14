import { WifiOff, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { useOffline } from "@/contexts/OfflineContext";
import { useTranslation } from "react-i18next";

export function OfflineBanner() {
  const { t } = useTranslation();
  const { isOnline, syncState, pendingCount } = useOffline();

  if (isOnline && syncState === "idle") return null;

  if (!isOnline) {
    return (
      <div className="bg-amber-500 text-white px-4 py-2.5 flex items-center justify-center gap-2 text-sm font-medium shadow-md z-50">
        <WifiOff className="w-4 h-4 shrink-0" />
        <span>
          {t("offline.youreOffline")}
          {pendingCount > 0 && ` ${t("offline.pending", { count: pendingCount })}`}
        </span>
      </div>
    );
  }

  if (syncState === "syncing") {
    return (
      <div className="bg-blue-500 text-white px-4 py-2.5 flex items-center justify-center gap-2 text-sm font-medium shadow-md z-50">
        <RefreshCw className="w-4 h-4 shrink-0 animate-spin" />
        <span>{t("offline.syncing")}</span>
      </div>
    );
  }

  if (syncState === "synced") {
    return (
      <div className="bg-emerald-500 text-white px-4 py-2.5 flex items-center justify-center gap-2 text-sm font-medium shadow-md z-50 animate-in fade-in duration-300">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        <span>{t("offline.synced")}</span>
      </div>
    );
  }

  if (syncState === "error") {
    return (
      <div className="bg-red-500 text-white px-4 py-2.5 flex items-center justify-center gap-2 text-sm font-medium shadow-md z-50">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>{t("offline.syncError")}</span>
      </div>
    );
  }

  return null;
}
