import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Link2, CheckCircle2, AlertTriangle, Unlink } from "lucide-react";
import {
  useGetQuickbooksStatus,
  getQuickbooksConnectUrl,
  useDisconnectQuickbooks,
  getGetQuickbooksStatusQueryKey,
} from "@workspace/api-client-react";

export function QuickBooksTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: status, isLoading } = useGetQuickbooksStatus();
  const disconnect = useDisconnectQuickbooks();

  const [banner, setBanner] = useState<"connected" | "error" | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qb = params.get("qb");
    if (qb === "connected") setBanner("connected");
    else if (qb === "error") setBanner("error");
    if (qb) {
      params.delete("qb");
      const newSearch = params.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (newSearch ? `?${newSearch}` : ""),
      );
    }
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await getQuickbooksConnectUrl();
      if (res?.authorizeUrl) {
        window.location.href = res.authorizeUrl;
      } else {
        setConnecting(false);
      }
    } catch {
      setBanner("error");
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await disconnect.mutateAsync();
    queryClient.invalidateQueries({ queryKey: getGetQuickbooksStatusQueryKey() });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      {banner === "connected" && (
        <div className="mb-5 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          {t("employment.quickbooks.connectedBanner")}
        </div>
      )}
      {banner === "error" && (
        <div className="mb-5 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {t("employment.quickbooks.errorBanner")}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-xl bg-[#2CA01C]/10 flex items-center justify-center">
            <Link2 className="w-6 h-6 text-[#2CA01C]" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">{t("employment.quickbooks.title")}</h3>
            <p className="text-sm text-slate-500">{t("employment.quickbooks.subtitle")}</p>
          </div>
        </div>

        {!status?.configured ? (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            <div className="flex items-center gap-2 font-medium mb-1">
              <AlertTriangle className="w-4 h-4" />
              {t("employment.quickbooks.notConfiguredTitle")}
            </div>
            <p className="text-amber-700">{t("employment.quickbooks.notConfiguredBody")}</p>
          </div>
        ) : status.connected ? (
          <div>
            <div className="flex items-center gap-2 text-sm text-emerald-700 mb-3">
              <CheckCircle2 className="w-4 h-4" />
              <span className="font-medium">{t("employment.quickbooks.connected")}</span>
            </div>
            {status.realmId && (
              <p className="text-xs text-slate-500 mb-4">
                {t("employment.quickbooks.companyId")}: {status.realmId}
              </p>
            )}
            <button
              onClick={handleDisconnect}
              disabled={disconnect.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              {disconnect.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
              {t("employment.quickbooks.disconnect")}
            </button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-slate-600 mb-4">{t("employment.quickbooks.connectPrompt")}</p>
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2CA01C] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#248016] disabled:opacity-60"
            >
              {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              {t("employment.quickbooks.connectButton")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
