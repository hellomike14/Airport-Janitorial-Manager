import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getAuthDiagnostics, type AccessState, type AuthDiagnostics } from "@/lib/authDiagnosticsApi";

function formatState(state: AccessState, t: (key: string) => string) {
  return [
    state.active ? t("staff.accessHealth.active") : t("staff.accessHealth.inactive"),
    state.hasEmail ? t("staff.accessHealth.hasEmail") : t("staff.accessHealth.noEmail"),
    state.loginEnabled ? t("staff.accessHealth.loginEnabled") : t("staff.accessHealth.loginDisabled"),
    state.formerEmployee ? t("staff.accessHealth.formerEmployee") : null,
  ].filter(Boolean).join(" · ");
}

export function AccessHealthSection() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<AuthDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(false);
    try {
      setData(await getAuthDiagnostics(signal));
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="section-access-health">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            {t("staff.accessHealth.title")}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{t("staff.accessHealth.last24Hours")}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
          data-testid="button-refresh-access-health"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("staff.accessHealth.refresh")}
        </button>
      </div>

      {loading && !data ? (
        <p className="mt-5 animate-pulse text-sm text-slate-500" role="status" data-testid="status-access-health-loading">
          {t("staff.accessHealth.loading")}
        </p>
      ) : error ? (
        <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert" data-testid="status-access-health-error">
          {t("staff.accessHealth.error")}
        </div>
      ) : !data || (data.events.length === 0 && data.summary.length === 0 && data.accessChanges.length === 0) ? (
        <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600" data-testid="status-access-health-empty">
          {t("staff.accessHealth.empty")}
        </p>
      ) : (
        <div className="mt-5 space-y-6">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">{t("staff.accessHealth.failureSummary")}</h3>
            {data.summary.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">{t("staff.accessHealth.noFailures")}</p>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {data.summary.map(item => (
                  <div key={item.code} className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2" data-testid={`summary-auth-failure-${item.code}`}>
                    <span className="flex items-center gap-2 text-sm font-medium text-amber-900">
                      <AlertTriangle className="h-4 w-4" /> {t(`staff.accessHealth.codes.${item.code}`, item.code)}
                    </span>
                    <strong className="text-amber-950">{item.count}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">{t("staff.accessHealth.recentEvents")}</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-slate-500"><tr><th className="pb-2">{t("staff.accessHealth.failure")}</th><th>{t("staff.accessHealth.source")}</th><th>{t("staff.accessHealth.diagnosticId")}</th><th>{t("staff.accessHealth.when")}</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.events.map(event => (
                    <tr key={`${event.diagnosticId}-${event.createdAt}`} data-testid={`row-auth-event-${event.diagnosticId}`}>
                      <td className="py-2 font-medium text-slate-800">{t(`staff.accessHealth.codes.${event.code}`, event.code)}</td>
                      <td>{event.source === "client" ? t("staff.accessHealth.clientUnverified") : t("staff.accessHealth.server")}</td>
                      <td className="font-mono text-xs">{event.diagnosticId}</td>
                      <td>{new Date(event.createdAt).toLocaleString(i18n.language)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">{t("staff.accessHealth.recentChanges")}</h3>
            {data.accessChanges.length === 0 ? <p className="mt-2 text-sm text-slate-500">{t("staff.accessHealth.noChanges")}</p> : (
              <div className="mt-2 space-y-3">
                {data.accessChanges.map(change => (
                  <div key={change.id} className="rounded-xl border border-slate-200 p-3 text-sm" data-testid={`card-access-change-${change.id}`}>
                    <p className="font-semibold text-slate-900">{change.actorName} · {change.action} · {change.staffName}</p>
                    <p className="mt-1 text-xs text-slate-500">{new Date(change.createdAt).toLocaleString(i18n.language)}</p>
                    <p className="mt-2 text-xs text-slate-600">{formatState(change.before, t)} → {formatState(change.after, t)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}