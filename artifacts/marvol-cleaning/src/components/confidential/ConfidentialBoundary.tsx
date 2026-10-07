import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfidentialAccess, errorCodeOf } from "@/contexts/ConfidentialAccessContext";
import { isValidCode } from "@/lib/confidentialLogic";

const field = "w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 tracking-widest focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20";

function CodeField({ id, label, value, onChange, autoComplete, describedBy }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string; describedBy?: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-slate-700">{label}</label>
      <input id={id} name={id} type="password" inputMode="numeric" pattern="[0-9]*" minLength={8} maxLength={12}
        autoComplete={autoComplete} value={value} aria-describedby={describedBy}
        onChange={e => onChange(e.target.value.replace(/\D/g, "").slice(0, 12))} className={field} required />
    </div>
  );
}

export function useCodeError() {
  const { t } = useTranslation();
  const [err, setErr] = useState<string | null>(null);
  const fail = (e: unknown) => {
    const code = errorCodeOf(e);
    const serverMsg = (e as { data?: { message?: string } })?.data?.message;
    if (code === "CONFIDENTIAL_CODE_WEAK" && serverMsg) return setErr(serverMsg);
    const known = ["CONFIDENTIAL_CODE_WEAK", "CONFIDENTIAL_CODE_WRONG", "CONFIDENTIAL_RATE_LIMIT", "CONFIDENTIAL_CODE_UNSET", "CONFIDENTIAL_UNAVAILABLE", "CONFIDENTIAL_LOCKED"];
    setErr(t(`confidential.errors.${known.includes(code) ? code : "generic"}`));
  };
  return { err, setErr, fail };
}

function Card({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div className="mx-auto my-8 max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="confidential-gate">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white"><LockKeyhole className="h-5 w-5" aria-hidden="true" /></div>
        <div><h2 className="text-lg font-bold text-slate-900">{title}</h2><p className="text-sm text-slate-500">{body}</p></div>
      </div>
      {children}
    </div>
  );
}

function Alert({ children }: { children: ReactNode }) {
  return <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{children}</p>;
}

function SetupForm() {
  const { t } = useTranslation(); const c = useConfidentialAccess(); const { err, setErr, fail } = useCodeError();
  const [code, setCode] = useState(""), [conf, setConf] = useState(""), [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValidCode(code)) return setErr(t("confidential.errors.format"));
    if (code !== conf) return setErr(t("confidential.errors.mismatch"));
    setBusy(true); setErr(null);
    try { await c.setup(code, conf); setCode(""); setConf(""); } catch (x) { fail(x); } finally { setBusy(false); }
  };
  return (
    <Card title={t("confidential.setupTitle")} body={t("confidential.setupBody")}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <p id="code-rules" className="text-xs text-slate-500">{t("confidential.rules")}</p>
        <CodeField id="new-code" label={t("confidential.newCode")} value={code} onChange={setCode} autoComplete="new-password" describedBy="code-rules" />
        <CodeField id="confirm-code" label={t("confidential.confirmCode")} value={conf} onChange={setConf} autoComplete="new-password" />
        {err && <Alert>{err}</Alert>}
        <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
          <KeyRound className="h-4 w-4" aria-hidden="true" />{t("confidential.setupAction")}
        </button>
      </form>
    </Card>
  );
}

function UnlockForm() {
  const { t } = useTranslation(); const c = useConfidentialAccess(); const { err, setErr, fail } = useCodeError();
  const [code, setCode] = useState(""), [busy, setBusy] = useState(false);
  const mins = Math.max(1, Math.ceil(c.cooldownMs / 60000));
  const cooling = c.cooldownMs > 0;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValidCode(code)) return setErr(t("confidential.errors.format"));
    setBusy(true); setErr(null);
    try { await c.unlock(code); } catch (x) { fail(x); } finally { setCode(""); setBusy(false); }
  };
  return (
    <Card title={t("confidential.unlockTitle")} body={t("confidential.unlockBody")}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <CodeField id="access-code" label={t("confidential.code")} value={code} onChange={setCode} autoComplete="off" />
        {cooling && <Alert>{t("confidential.cooldown", { count: mins })}</Alert>}
        {err && !cooling && <Alert>{err}</Alert>}
        <button disabled={busy || cooling} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />{t("confidential.unlockAction")}
        </button>
      </form>
      <p className="mt-4 text-xs leading-relaxed text-slate-500">{t("confidential.lostCode")}</p>
    </Card>
  );
}

function LoadState({ error }: { error: boolean }) {
  const { t } = useTranslation(); const c = useConfidentialAccess();
  if (!error) return <div role="status" className="mx-auto my-8 max-w-md animate-pulse rounded-2xl border border-slate-200 bg-white p-6 text-slate-500">{t("confidential.loading")}</div>;
  return (
    <Card title={t("confidential.loadFailedTitle")} body={t("confidential.loadFailedBody")}>
      <button onClick={c.refresh} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">
        <RefreshCw className="h-4 w-4" aria-hidden="true" />{t("confidential.retry")}
      </button>
    </Card>
  );
}

export function ChangeCodeDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(); const c = useConfidentialAccess(); const { err, setErr, fail } = useCodeError();
  const [cur, setCur] = useState(""), [code, setCode] = useState(""), [conf, setConf] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValidCode(cur) || !isValidCode(code)) return setErr(t("confidential.errors.format"));
    if (code !== conf) return setErr(t("confidential.errors.mismatch"));
    setBusy(true); setErr(null);
    try { await c.change(cur, code, conf); onClose(); } catch (x) { fail(x); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-labelledby="chg-title">
      <form onSubmit={submit} noValidate className="w-full max-w-md space-y-3 rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="chg-title" className="text-lg font-bold text-slate-900">{t("confidential.changeTitle")}</h2>
        <p className="text-xs text-slate-500">{t("confidential.changeHelp")}</p>
        <CodeField id="current-code" label={t("confidential.currentCode")} value={cur} onChange={setCur} autoComplete="off" />
        <CodeField id="chg-new" label={t("confidential.newCode")} value={code} onChange={setCode} autoComplete="new-password" />
        <CodeField id="chg-confirm" label={t("confidential.confirmCode")} value={conf} onChange={setConf} autoComplete="new-password" />
        {err && <Alert>{err}</Alert>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700">{t("common.cancel")}</button>
          <button disabled={busy} className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-60">{t("confidential.changeAction")}</button>
        </div>
      </form>
    </div>
  );
}

function Toolbar() {
  const { t } = useTranslation(); const c = useConfidentialAccess(); const [open, setOpen] = useState(false);
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
      <span className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4" aria-hidden="true" />{t("confidential.unlockedNotice")}</span>
      <span className="flex gap-2">
        <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-emerald-300 bg-white px-3 py-1 font-semibold">{t("confidential.changeTitle")}</button>
        <button type="button" onClick={() => void c.lock()} className="rounded-lg bg-emerald-800 px-3 py-1 font-semibold text-white">{t("confidential.lockNow")}</button>
      </span>
      {open && <ChangeCodeDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Renders children only for a signed-in Admin whose server grant is currently valid. */
export function ConfidentialBoundary({ children }: { children: ReactNode }) {
  const { effectiveRole, currentUser } = useAuth();
  const c = useConfidentialAccess();
  if (!currentUser || effectiveRole !== "admin") return null;
  if (c.status === "loading" || c.status === "idle") return <LoadState error={false} />;
  if (c.status === "error") return <LoadState error />;
  if (!c.configured) return <SetupForm />;
  if (!c.unlocked) return <UnlockForm />;
  return <><Toolbar />{children}</>;
}
