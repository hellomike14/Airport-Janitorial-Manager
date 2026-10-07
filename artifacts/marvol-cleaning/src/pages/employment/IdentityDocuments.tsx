import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, Upload, ShieldCheck, Eye, EyeOff, Lock, RotateCcw, X } from "lucide-react";
import {
  getIdentityContext, getIdentityPhotos, linkIdentityHire, uploadIdentityPhoto,
  reviewIdentityPhoto, getIdentityPhotoBlob, identityFileType, IDENTITY_MAX_BYTES,
  type IdentityContext, type IdentityPhoto, type IdentityCategory, type IdentitySide, type PhotoReason, type IdentityEvent,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";

const CATEGORIES: IdentityCategory[] = ["identity", "work_authorization", "social_security"];
const SIDES: IdentitySide[] = ["front", "back"];
const REASONS: PhotoReason[] = ["blurry", "glare", "cropped", "wrong_side", "other"];
const btn = "inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50";
const msg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function useCoarse() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
}

function PhotoViewer({ id }: { id: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    let made: string | null = null;
    setError(false);
    getIdentityPhotoBlob(id, ctl.signal).then(b => {
      if (ctl.signal.aborted) return;
      made = URL.createObjectURL(b); setUrl(made);
    })
      .catch(e => { if (!ctl.signal.aborted) setError(true); void e; });
    return () => { ctl.abort(); if (made) URL.revokeObjectURL(made); setUrl(null); };
  }, [open, id]);
  return (
    <div>
      <button type="button" data-testid={`view-photo-${id}`} onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:underline">
        {open ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        {open ? t("employment.identity.hideView") : t("employment.identity.view")}
      </button>
      {open && error && <p role="alert" className="mt-2 text-sm text-red-700">{t("employment.identity.viewError")}</p>}
      {open && !error && !url && <div className="mt-2 h-40 animate-pulse rounded-lg bg-slate-100" aria-label={t("employment.identity.preparing")} />}
      {open && url && <img src={url} alt="" className="mt-2 max-h-80 w-full rounded-lg border border-slate-200 object-contain bg-slate-50" />}
    </div>
  );
}

function Audit({ p, admin }: { p: IdentityPhoto; admin: boolean }) {
  const { t, i18n } = useTranslation();
  const d = (s: string) => new Date(s).toLocaleString(i18n.language);
  return (
    <div className="text-xs text-slate-500 space-y-0.5">
      <p>{t("employment.identity.uploadedBy", { name: p.uploadedBy.name, date: d(p.uploadedAt) })}</p>
      {p.reviewedBy && p.reviewedAt && <p>{t("employment.identity.reviewedBy", { name: p.reviewedBy.name, date: d(p.reviewedAt) })}</p>}
      {p.supersededAt && <p>{t("employment.identity.superseded", { date: d(p.supersededAt) })}</p>}
      {p.status === "needs_clearer_photo" && p.qualityReason && <p>{t(`employment.identity.${p.qualityReason}`)}</p>}
    </div>
  );
}

function ReviewControls({ p, onDone }: { p: IdentityPhoto; onDone: () => void }) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<"reviewed" | "needs_clearer_photo" | null>(p.status === "uploaded" ? null : p.status);
  const [reason, setReason] = useState<PhotoReason>(p.qualityReason ?? "blurry");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    if (!choice) return;
    setBusy(true); setErr("");
    try { await reviewIdentityPhoto(p.id, choice, choice === "needs_clearer_photo" ? reason : undefined); onDone(); }
    catch { setErr(t("employment.identity.reviewError")); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-2 rounded-lg bg-slate-50 p-3 space-y-2" data-testid={`review-${p.id}`}>
      <div className="flex flex-wrap gap-4 text-sm">
        {(["reviewed", "needs_clearer_photo"] as const).map(c => (
          <label key={c} className="flex items-center gap-2">
            <input type="radio" name={`rv-${p.id}`} checked={choice === c} onChange={() => setChoice(c)} data-testid={`review-choice-${c}-${p.id}`} />
            {c === "reviewed" ? t("employment.identity.markReviewed") : t("employment.identity.markClearer")}
          </label>
        ))}
      </div>
      {choice === "needs_clearer_photo" && (
        <label className="block text-sm">{t("employment.identity.reason")}
          <select value={reason} onChange={e => setReason(e.target.value as PhotoReason)} data-testid={`review-reason-${p.id}`}
            className="ml-2 rounded-md border border-slate-300 px-2 py-1">
            {REASONS.map(r => <option key={r} value={r}>{t(`employment.identity.${r}`)}</option>)}
          </select>
        </label>
      )}
      {choice === "reviewed" && <p className="text-xs text-slate-500">{t("employment.identity.reviewedNote")}</p>}
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      <button type="button" disabled={busy || !choice} onClick={save} data-testid={`review-save-${p.id}`} className={`${btn} bg-slate-900 text-white`}>
        {t("employment.identity.saveReview")}
      </button>
    </div>
  );
}

function Slot({ hireId, category, side, versions, admin, onChanged }: {
  hireId: number; category: IdentityCategory; side: IdentitySide; versions: IdentityPhoto[]; admin: boolean; onChanged: () => void;
}) {
  const { t } = useTranslation();
  const coarse = useCoarse();
  const current = versions.find(v => !v.supersededAt) ?? null;
  const history = versions.filter(v => v !== current);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewBroken, setPreviewBroken] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const upRef = useRef<HTMLInputElement>(null);
  const key = `${category}-${side}`;

  const discard = useCallback(() => { ctl.current?.abort(); ctl.current = null; setFile(null); setProgress(null); setError(""); setPreviewBroken(false); }, []);
  useEffect(() => () => { ctl.current?.abort(); }, []);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    let type = "";
    try { type = identityFileType(file); } catch { /* validated on select */ }
    if (type === "image/heic" || type === "image/heif") { setPreview(null); return; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    setError("");
    try {
      identityFileType(f);
      if (!f.size || f.size > IDENTITY_MAX_BYTES) throw new Error("size");
    } catch { setError(t("employment.identity.badFile")); return; }
    setPreviewBroken(false); setFile(f);
  };
  const submit = async () => {
    if (!file) return;
    const c = new AbortController(); ctl.current = c; setError(""); setProgress(0);
    try {
      await uploadIdentityPhoto({ hireId, category, side, replacesId: current?.id ?? null }, file, { signal: c.signal, onProgress: setProgress });
      if (ctl.current === c) { setFile(null); setProgress(null); onChanged(); }
    } catch (e) {
      if (c.signal.aborted) return;
      setProgress(null); setError(msg(e, t("employment.identity.uploadError")));
    }
  };
  const busy = progress !== null;
  const showPreview = file && preview && !previewBroken;

  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-2" data-testid={`slot-${key}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-800">{t(`employment.identity.${side}`)}</h4>
        {current && <span data-testid={`status-${key}`} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
          current.status === "reviewed" ? "bg-emerald-50 text-emerald-700" : current.status === "needs_clearer_photo" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
          {t(`employment.identity.${current.status}`)}</span>}
      </div>
      {current ? (
        <div className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("employment.identity.current")}</span>
          <Audit p={current} admin={admin} />
          <PhotoViewer id={current.id} />
           {admin && <ReviewControls key={`${current.id}:${current.status}:${current.reviewedAt}`} p={current} onDone={onChanged} />}
        </div>
      ) : <p className="text-sm text-slate-500">{t("employment.identity.none")}</p>}

      {file && (
        <div className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50/50 p-3 space-y-2" data-testid={`pending-${key}`}>
          {showPreview
            ? <img src={preview!} alt="" onError={() => setPreviewBroken(true)} className="max-h-60 w-full rounded-md object-contain" />
            : <p className="flex items-start gap-2 text-sm text-slate-700"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />{t("employment.identity.selected")}</p>}
          {showPreview && <p className="text-xs text-slate-500">{t("employment.identity.selectedReady")}</p>}
          {busy && <div role="progressbar" aria-valuenow={progress ?? 0} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-emerald-600 transition-[width]" style={{ width: `${progress}%` }} /></div>}
          {busy && <p className="text-xs text-slate-600">{t("employment.identity.submitting", { n: progress })}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={submit} data-testid={`submit-${key}`} className={`${btn} bg-emerald-600 text-white`}>
              {error ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : null}{error ? t("employment.identity.retry") : t("employment.identity.submit")}</button>
            <button type="button" disabled={busy} onClick={() => { discard(); (coarse ? camRef : upRef).current?.click(); }} data-testid={`retake-${key}`} className={`${btn} border border-slate-300`}>{t("employment.identity.retake")}</button>
            <button type="button" disabled={(progress ?? 0) >= 95} onClick={discard} data-testid={`cancel-${key}`} className={`${btn} border border-slate-300`}><X className="h-4 w-4" aria-hidden="true" />{t("employment.identity.cancel")}</button>
          </div>
        </div>
      )}
      {error && <p role="alert" data-testid={`error-${key}`} className="text-sm text-red-700">{error}</p>}

      {!file && (
        <div className="flex flex-wrap gap-2">
          {coarse && <button type="button" onClick={() => camRef.current?.click()} data-testid={`take-${key}`} className={`${btn} bg-slate-900 text-white`}>
            <Camera className="h-4 w-4" aria-hidden="true" />{current ? t("employment.identity.replace") + ": " : ""}{t("employment.identity.takePhoto")}</button>}
          <button type="button" onClick={() => upRef.current?.click()} data-testid={`upload-${key}`} className={`${btn} border border-slate-300 text-slate-700`}>
            <Upload className="h-4 w-4" aria-hidden="true" />{current ? t("employment.identity.replace") + ": " : ""}{t("employment.identity.uploadPhoto")}</button>
        </div>
      )}
      {coarse && <input ref={camRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" className="hidden"
        data-testid={`input-camera-${key}`} onChange={e => { pick(e.target.files?.[0]); e.target.value = ""; }} />}
      <input ref={upRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="hidden"
        data-testid={`input-upload-${key}`} onChange={e => { pick(e.target.files?.[0]); e.target.value = ""; }} />

      {history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-600">{t("employment.identity.history")} ({history.length})</summary>
          <ul className="mt-2 space-y-3">
            {history.map(h => <li key={h.id} className="border-l-2 border-slate-200 pl-3 space-y-1" data-testid={`history-${h.id}`}>
              <Audit p={h} admin={admin} /><PhotoViewer id={h.id} /></li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function LinkPanel({ ctx, hireId, onLinked }: { ctx: IdentityContext; hireId: number; onLinked: () => void }) {
  const { t } = useTranslation();
  const [staffId, setStaffId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async () => {
    setBusy(true); setErr("");
    try { await linkIdentityHire(hireId, Number(staffId)); onLinked(); }
    catch (e) { setErr(msg(e, t("employment.identity.loadError"))); }
    finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3" data-testid="identity-link-panel">
      <h3 className="font-semibold text-slate-900">{t("employment.identity.linkTitle")}</h3>
      <p className="text-sm text-slate-600">{t("employment.identity.linkHelp")}</p>
      <select value={staffId} onChange={e => { setStaffId(e.target.value); setConfirmed(false); }} data-testid="identity-employee-select"
        aria-label={t("employment.identity.employee")} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
        <option value="">{t("employment.identity.chooseEmployee")}</option>
        {ctx.employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={!staffId} onChange={e => setConfirmed(e.target.checked)} data-testid="identity-link-confirm" />{t("employment.identity.linkConfirmText")}</label>
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      <button type="button" disabled={!staffId || !confirmed || busy} onClick={go} data-testid="identity-link-submit" className={`${btn} bg-slate-900 text-white`}>
        {busy ? t("employment.identity.linking") : t("employment.identity.confirmLink")}</button>
    </div>
  );
}

function HirePhotos({ ctx, hireId, admin, onLinked }: { ctx: IdentityContext; hireId: number; admin: boolean; onLinked: () => void }) {
  const { t } = useTranslation();
  const hire = ctx.hires.find(h => h.id === hireId)!;
  const [photos, setPhotos] = useState<IdentityPhoto[] | null>(null);
  const [events, setEvents] = useState<IdentityEvent[]>([]);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const linked = hire.staffId !== null;
  useEffect(() => {
    // Keep other slots' unsent front/back selections during a successful save.
    setError(false);
    if (!linked) return;
    const ctl = new AbortController();
    getIdentityPhotos(hireId, ctl.signal).then(r => {
      if (!ctl.signal.aborted) { setPhotos(r.photos); setEvents(r.events); }
    })
      .catch(() => { if (!ctl.signal.aborted) setError(true); });
    return () => ctl.abort();
  }, [hireId, linked, tick]);
  const refresh = useCallback(() => setTick(n => n + 1), []);

  if (!linked) return admin ? <LinkPanel ctx={ctx} hireId={hireId} onLinked={onLinked} /> : null;
  const loadError = <div role="alert" className="text-sm text-red-700">{t("employment.identity.loadError")} <button type="button" onClick={refresh} className="underline" data-testid="identity-photos-retry">{t("employment.identity.retry")}</button></div>;
  if (error && !photos) return loadError;
  if (!photos) return <div className="h-32 animate-pulse rounded-xl bg-slate-100" aria-label={t("employment.identity.loading")} />;
  return (
    <div className="space-y-5">
      {error && loadError}
      {hire.staffName && <p className="text-sm text-slate-500">{t("employment.identity.linkedTo", { name: hire.staffName })}</p>}
      {CATEGORIES.map(cat => (
        <section key={cat} data-testid={`category-${cat}`}>
          <div className="mb-2 flex items-center gap-2"><h3 className="font-semibold text-slate-800">{t(`employment.identity.${cat}`)}</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{t("employment.identity.optional")}</span></div>
          <div className="grid gap-3 md:grid-cols-2">
            {SIDES.map(s => <Slot key={s} hireId={hireId} category={cat} side={s} admin={admin} onChanged={refresh}
              versions={photos.filter(p => p.category === cat && p.side === s).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))} />)}
          </div>
        </section>
      ))}
      {admin && events.length > 0 && (
        <details data-testid="identity-audit-history" className="rounded-xl border border-slate-200 p-4 text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">{t("employment.identity.activity")}</summary>
          <ul className="mt-3 space-y-2 text-xs text-slate-500">
            {events.map(event => {
              const labels: Record<string, string> = {
                employee_linked: "employeeLinked", photo_uploaded: "uploaded",
                photo_replaced: "replace", photo_viewed: "view",
                reviewed: "reviewed", needs_clearer_photo: "needs_clearer_photo",
              };
              return <li key={event.id}>
                {t(`employment.identity.${labels[event.action] ?? "activity"}`)}
                {" — "}{event.actor.name}{" · "}{new Date(event.createdAt).toLocaleString()}
                {event.details && ` · ${t(`employment.identity.${event.details}`)}`}
              </li>;
            })}
          </ul>
        </details>
      )}
    </div>
  );
}

function IdentityDocumentsContent() {
  const { t } = useTranslation();
  const auth = useAuth();
  const role = auth.effectiveRole;
  const allowed = role === "admin";
  const [ctx, setCtx] = useState<IdentityContext | null>(null);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const [hireId, setHireId] = useState<number | null>(null);
  useEffect(() => {
    setCtx(null); setError(false); setHireId(null);
    if (!allowed) return;
    const ctl = new AbortController();
    getIdentityContext(ctl.signal).then(c => {
      if (ctl.signal.aborted) return;
      setCtx(c);
      if (!c.canManage && c.hires[0]) setHireId(c.hires[0].id);
    }).catch(() => { if (!ctl.signal.aborted) setError(true); });
    return () => ctl.abort();
  }, [allowed, role, auth.currentUser?.id, tick]);
  const admin = !!ctx?.canManage && role === "admin";
  const reload = useMemo(() => () => setTick(n => n + 1), []);
  if (!allowed) return null;

  const hire = ctx?.hires.find(h => h.id === hireId);
  return (
    <section aria-labelledby="identity-title" data-testid="identity-documents" className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8 space-y-5">
      <div>
        <h2 id="identity-title" className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Lock className="h-5 w-5 text-emerald-600" aria-hidden="true" />{t("employment.identity.title")}</h2>
        <p className="mt-1 text-sm text-slate-500">{t("employment.identity.intro")}</p>
      </div>
      <p data-testid="identity-i9-notice" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900">{t("employment.identity.notice")}</p>
      {error && <div role="alert" className="text-sm text-red-700">{t("employment.identity.loadError")} <button type="button" className="underline" onClick={reload} data-testid="identity-retry">{t("employment.identity.retry")}</button></div>}
      {!error && !ctx && <div className="h-24 animate-pulse rounded-xl bg-slate-100" aria-label={t("employment.identity.loading")} />}
      {ctx && !admin && !hire?.staffId && <p data-testid="identity-contact-hr" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{t("employment.identity.contactHr")}</p>}
      {ctx && admin && (ctx.hires.length === 0
        ? <p className="text-sm text-slate-500">{t("employment.identity.noHires")}</p>
        : <label className="block text-sm font-medium text-slate-700">{t("employment.identity.hire")}
          <select value={hireId ?? ""} onChange={e => setHireId(e.target.value ? Number(e.target.value) : null)} data-testid="identity-hire-select"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:max-w-sm">
            <option value="">{t("employment.identity.chooseHire")}</option>
            {ctx.hires.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select></label>)}
      {ctx && hire && (admin || hire.staffId !== null) && <HirePhotos key={hire.id} ctx={ctx} hireId={hire.id} admin={admin} onLinked={reload} />}
    </section>
  );
}

export default function IdentityDocuments() {
  const auth = useAuth();
  if (auth.effectiveRole !== "admin") return null;
  // Remount synchronously on identity changes, before old private views paint.
  return <IdentityDocumentsContent key={`${auth.currentUser?.id ?? ""}:${auth.effectiveRole}`} />;
}
