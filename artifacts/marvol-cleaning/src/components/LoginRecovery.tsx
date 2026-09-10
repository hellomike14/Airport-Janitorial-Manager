import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function SlowSignInHelp() {
  const { t } = useTranslation();
  const [slow, setSlow] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setSlow(true), 15000); return () => clearTimeout(timer); }, []);
  if (!slow) return null;
  return <div role="status" className="relative z-10 mt-5 max-w-md rounded-xl bg-white p-4 text-center text-sm text-slate-700">
    <p>{t("login.slowHelp")}</p>
    <button type="button" onClick={() => window.location.reload()} className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white">{t("login.reload")}</button>
  </div>;
}

export function LoginRecovery({ kind = "loading", retry, signOut }: {
  kind?: "loading" | "error" | "expired";
  retry?: () => void; signOut?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [slow, setSlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setSlow(true), 15000); return () => clearTimeout(timer); }, []);
  const waiting = kind === "loading" && !slow;
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
        <h1 className="text-xl font-bold text-slate-900">{t(kind === "expired" ? "login.sessionExpired" : "login.connectionTitle")}</h1>
        <p role="alert" className="mt-3 text-sm text-slate-600">{t(kind === "expired" ? "login.sessionExpiredHelp" : "login.connectionHelp")}</p>
        {retry && kind !== "expired" && <button type="button" onClick={retry} className="mt-5 w-full rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white">{t("login.retry")}</button>}
        {signOut && <button type="button" disabled={busy} onClick={restart} className="mt-3 w-full rounded-lg bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50">{t("login.signInAgain")}</button>}
        <button type="button" onClick={() => window.location.reload()} className="mt-3 rounded-lg px-4 py-2 font-semibold text-emerald-800 underline">{t("login.reload")}</button>
        {failed && <p role="alert" className="mt-3 text-sm text-red-700">{t("login.reloadHelp")}</p>}
      </>}
    </div>
  </main>;
}
