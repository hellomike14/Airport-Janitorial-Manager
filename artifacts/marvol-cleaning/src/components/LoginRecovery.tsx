import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function LoginRecovery({ kind = "loading", retry, signOut, diagnosticId }: {
  kind?: "loading" | "slow" | "bootstrap-error" | "error" | "expired" | "disabled" | "unavailable";
  retry?: () => void; signOut?: () => Promise<void>;
  diagnosticId?: string;
}) {
  const { t } = useTranslation();
  const [slow, setSlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (kind !== "loading") return;
    const timer = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(timer);
  }, [kind]);
  const waiting = kind === "loading" && !slow;
  const stillLoading = kind === "loading" || kind === "slow";
  const title = kind === "expired" ? "login.sessionExpired"
    : kind === "disabled" ? "login.accessDisabledTitle"
    : kind === "unavailable" ? "login.serviceUnavailableTitle"
    : stillLoading ? "login.slowTitle"
    : kind === "bootstrap-error" ? "login.bootstrapTitle" : "login.connectionTitle";
  const help = kind === "expired" ? "login.sessionExpiredHelp"
    : kind === "disabled" ? "login.accessDisabledHelp"
    : kind === "unavailable" ? "login.serviceUnavailableHelp"
    : stillLoading ? "login.slowLoadingHelp"
    : kind === "bootstrap-error" ? "login.bootstrapHelp" : "login.connectionHelp";
  const restart = async () => {
    if (!signOut) return;
    setBusy(true); setFailed(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([signOut(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Sign out timed out")), 12000);
      })]);
    } catch { setFailed(true); }
    finally { clearTimeout(timer); setBusy(false); }
  };
  return <main className="min-h-screen bg-gradient-to-br from-emerald-950 via-green-900 to-emerald-950 flex items-center justify-center p-5">
    <div className="w-full max-w-md rounded-2xl bg-white p-7 text-center shadow-xl">
      {waiting ? <div role="status" aria-live="polite"><span aria-hidden="true" className="inline-block animate-spin text-3xl text-emerald-700">↻</span><p className="mt-3 text-slate-700">{t("login.loading")}</p></div> : <>
        <h1 className="text-xl font-bold text-slate-900">{t(title)}</h1>
        <p role={stillLoading ? "status" : "alert"} className="mt-3 text-sm text-slate-600">{t(help)}</p>
        {diagnosticId && <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700" data-testid="text-diagnostic-id">{t("login.diagnosticId", { id: diagnosticId })}</p>}
        {retry && kind !== "expired" && kind !== "disabled" && <button type="button" onClick={retry} className="mt-5 w-full rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white" data-testid="button-retry-login">{t("login.retry")}</button>}
        {signOut && <button type="button" disabled={busy} onClick={restart} className="mt-3 w-full rounded-lg bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50" data-testid="button-sign-in-again">{t(kind === "disabled" ? "layout.logout" : "login.signInAgain")}</button>}
        {kind !== "disabled" && <button type="button" onClick={() => window.location.reload()} className="mt-3 rounded-lg px-4 py-2 font-semibold text-emerald-800 underline" data-testid="button-reload-login">{t("login.reload")}</button>}
        {failed && <p role="alert" className="mt-3 text-sm text-red-700">{t("login.reloadHelp")}</p>}
      </>}
    </div>
  </main>;
}
