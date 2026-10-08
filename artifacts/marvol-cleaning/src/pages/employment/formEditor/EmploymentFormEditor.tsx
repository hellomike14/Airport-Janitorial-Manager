import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Download, Loader2, Minus, Plus, Printer, RefreshCw, Upload, X } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { useSubmitEmploymentForm } from "@workspace/api-client-react";
import { fetchFormBytes, type EmploymentFormId } from "./formSources";
import { downloadBytes, openDocument } from "./pdfRuntime";
import { uploadEmploymentFormFile } from "./privateUpload";
import { PdfPage } from "./PdfPage";
import { PdfPrintPreview } from "../PdfPrintPreview";

interface Props {
  formId: EmploymentFormId;
  title: string;
  onClose: () => void;
  onSubmitted: (emailSent: boolean) => void;
}

const BTN = "inline-flex min-h-[40px] items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50";
const MAX_PHOTO_FILES = 3;
const MAX_TOTAL_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;

export default function EmploymentFormEditor({ formId, title, onClose, onSubmitted }: Props) {
  const { t } = useTranslation();
  const submitForm = useSubmitEmploymentForm();
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [renderError, setRenderError] = useState(false);
  const [renderKey, setRenderKey] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [dirty, setDirty] = useState(false);
  const editRevision = useRef(0);
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [idPhotoFiles, setIdPhotoFiles] = useState<File[]>([]);
  const [current, setCurrent] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const photoPicker = useRef<HTMLInputElement>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty || Boolean(firstName || lastName || email || phone || idPhotoFiles.length);

  // Load original template (never modified); destroy doc on unmount to drop all entries.
  useEffect(() => {
    const ac = new AbortController();
    let opened: PDFDocumentLoadingTask | null = null;
    setDoc(null); setLoadError(false); setRenderError(false);
    (async () => {
      try {
        const bytes = await fetchFormBytes(formId, ac.signal);
        const { task, doc: d } = await openDocument(bytes);
        if (ac.signal.aborted) { void task.destroy(); return; }
        opened = task;
        setDoc(d);
      } catch (e) {
        if (!ac.signal.aborted) setLoadError(true);
      }
    })();
    return () => { ac.abort(); if (opened) void opened.destroy(); };
  }, [formId, attempt]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [doc]);

  // Track visible page for the indicator.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !doc) return;
    const onScroll = () => {
      const mid = el.getBoundingClientRect().top + el.clientHeight / 3;
      let found = 1;
      el.querySelectorAll<HTMLElement>("[data-page-number]").forEach((p) => {
        if (p.getBoundingClientRect().top <= mid) found = Number(p.dataset.pageNumber);
      });
      setCurrent(found);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [doc]);

  const scale = useMemo(() => {
    const fit = Math.max((width - 24) / 612, 1.0); // keep text readable on phones; scroll sideways if needed
    return Math.round(fit * zoom * 100) / 100;
  }, [width, zoom]);

  const goTo = (n: number) => {
    const page = doc ? Math.min(Math.max(n, 1), doc.numPages) : 1;
    scroller.current?.querySelector(`[data-page-number="${page}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    setCurrent(page);
  };

  const exportBytes = useCallback(async () => {
    if (!doc) throw new Error("no document");
    return doc.saveDocument();
  }, [doc]);

  const onSave = async () => {
    const revision = editRevision.current;
    setBusy("save"); setNotice(null);
    try {
      downloadBytes(await exportBytes(), `marvol-${formId}-completed.pdf`);
      if (editRevision.current === revision) setDirty(false);
      setNotice({ kind: "ok", text: t("employment.forms.editor.savedToDevice") });
    } catch { setNotice({ kind: "err", text: t("employment.forms.editor.saveError") }); }
    finally { setBusy(null); }
  };
  const onPrint = () => {
    if (!doc) return;
    setNotice(null);
    setPrintPreviewOpen(true);
  };
  const onPhotoSelect = (files: FileList | null) => {
    if (!files?.length) return;
    const selected = Array.from(files);
    const currentBytes = idPhotoFiles.reduce((sum, file) => sum + file.size, 0);
    if (idPhotoFiles.length + selected.length > MAX_PHOTO_FILES ||
        selected.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size <= 0 || file.size > MAX_UPLOAD_FILE_BYTES) ||
        currentBytes + selected.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_UPLOAD_BYTES) {
      setNotice({ kind: "err", text: t("employment.forms.editor.photoLimit") });
      if (photoPicker.current) photoPicker.current.value = "";
      return;
    }
    setNotice(null);
    setIdPhotoFiles(previous => [...previous, ...selected]);
    if (photoPicker.current) photoPicker.current.value = "";
  };
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);
    if (!doc || !firstName.trim() || !lastName.trim() || !email.trim()) {
      setNotice({ kind: "err", text: t("employment.forms.editor.contactRequired") });
      return;
    }
    setBusy("submit");
    try {
      const pdfBytes = await exportBytes();
      if (pdfBytes.byteLength + idPhotoFiles.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_UPLOAD_BYTES) {
        throw new Error("EMPLOYMENT_FORM_UPLOAD_TOO_LARGE");
      }
      const pdfFile = new File([pdfBytes], `marvol-${formId}-completed.pdf`, { type: "application/pdf" });
      const completedPdf = await uploadEmploymentFormFile(pdfFile);
      const photos = await Promise.all(idPhotoFiles.map(uploadEmploymentFormFile));
      const receipt = await submitForm.mutateAsync({
        data: {
          formId,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          completedPdf,
          idPhotos: photos,
        },
      });
      setDirty(false);
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      setIdPhotoFiles([]);
      onSubmitted(receipt.emailSent);
    } catch {
      setNotice({ kind: "err", text: t("employment.forms.editor.submitError") });
    } finally {
      setBusy(null);
    }
  };
  const requestClose = () => (dirtyRef.current ? setConfirmClose(true) : onClose());

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !confirmClose) requestClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const pages = doc ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : [];

  return (
    <div role="dialog" aria-modal="true" aria-label={title} data-testid="form-editor"
      className={`fixed inset-0 flex flex-col bg-slate-200 ${printPreviewOpen ? "z-40" : "z-[80]"}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-300 bg-white px-3 py-2 sm:px-5">
        <div className="mr-auto min-w-0">
          <h2 className="truncate text-base font-semibold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500" data-testid="form-editor-memory-note">
            {dirty ? t("employment.forms.editor.unexported") : t("employment.forms.editor.memoryNote")}
          </p>
        </div>
        <button type="button" className={`${BTN} bg-emerald-600 text-white hover:bg-emerald-700`}
          onClick={onSave} disabled={!doc || busy !== null} data-testid="form-editor-save">
          {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
          {t("employment.forms.editor.save")}
        </button>
        <button type="button" className={`${BTN} border border-slate-300 text-slate-700 hover:bg-slate-50`}
          onClick={onPrint} disabled={!doc || busy !== null} data-testid="form-editor-print">
          <Printer className="h-4 w-4" aria-hidden="true" />
          {t("employment.forms.editor.print")}
        </button>
        <button type="button" className={`${BTN} text-slate-700 hover:bg-slate-100`}
          onClick={requestClose} data-testid="form-editor-close">
          <X className="h-4 w-4" aria-hidden="true" />
          {t("employment.forms.editor.close")}
        </button>
      </header>

      {doc && (
        <div className="flex items-center justify-center gap-1 border-b border-slate-300 bg-slate-50 px-3 py-1.5 text-sm text-slate-700">
          <button type="button" className={`${BTN} hover:bg-slate-200`} onClick={() => goTo(current - 1)}
            disabled={current <= 1} aria-label={t("employment.forms.editor.prevPage")} data-testid="form-editor-prev">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <span aria-live="polite" data-testid="form-editor-page" className="min-w-[96px] text-center tabular-nums">
            {t("employment.forms.editor.pageOf", { page: current, total: doc.numPages })}
          </span>
          <button type="button" className={`${BTN} hover:bg-slate-200`} onClick={() => goTo(current + 1)}
            disabled={current >= doc.numPages} aria-label={t("employment.forms.editor.nextPage")} data-testid="form-editor-next">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="mx-2 h-5 w-px bg-slate-300" aria-hidden="true" />
          <button type="button" className={`${BTN} hover:bg-slate-200`} onClick={() => setZoom((z) => Math.max(0.75, z - 0.25))}
            disabled={zoom <= 0.75} aria-label={t("employment.forms.editor.zoomOut")}>
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button type="button" className={`${BTN} hover:bg-slate-200`} onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
            disabled={zoom >= 2} aria-label={t("employment.forms.editor.zoomIn")}>
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {notice && (
        <div role={notice.kind === "err" ? "alert" : "status"} data-testid="form-editor-notice"
          className={`px-4 py-2 text-sm ${notice.kind === "err" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>
          {notice.text}
        </div>
      )}
      {renderError && (
        <div role="alert" data-testid="form-editor-render-error"
          className="flex flex-wrap items-center gap-3 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span>{t("employment.forms.editor.renderError")}</span>
          <button type="button" className="underline" onClick={() => setRenderError(false)}>{t("employment.forms.editor.dismiss")}</button>
        </div>
      )}

      <div ref={scroller}
        onInput={() => { editRevision.current++; setDirty(true); }}
        onChange={() => { editRevision.current++; setDirty(true); }}
        className="min-h-0 flex-1 overflow-auto px-3 py-4" data-testid="form-editor-scroll">
        {!doc && !loadError && (
          <div className="mx-auto mt-10 max-w-md animate-pulse space-y-3" role="status" data-testid="form-editor-loading">
            <div className="h-[420px] rounded bg-white" />
            <p className="text-center text-sm text-slate-600">{t("employment.forms.editor.loading")}</p>
          </div>
        )}
        {loadError && (
          <div role="alert" data-testid="form-editor-load-error"
            className="mx-auto mt-10 max-w-md rounded-xl border border-red-200 bg-white p-6 text-center">
            <p className="font-medium text-red-800">{t("employment.forms.editor.loadError")}</p>
            <button type="button" className={`${BTN} mt-4 bg-emerald-600 text-white hover:bg-emerald-700`}
              onClick={() => setAttempt((a) => a + 1)} data-testid="form-editor-retry">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {t("employment.forms.editor.retry")}
            </button>
          </div>
        )}
        {doc && (
          <div className="mx-auto flex w-max min-w-full flex-col items-center gap-4">
            {pages.map((n) => (
              <PdfPage key={`${renderKey}-${n}`} doc={doc} pageNumber={n} scale={scale}
                label={t("employment.forms.editor.pageOf", { page: n, total: doc.numPages })}
                fieldLabel={(i) => t("employment.forms.editor.field", { n: i })}
                onError={() => setRenderError(true)} />
            ))}
            {renderError && (
              <button type="button" className={`${BTN} bg-white text-slate-800 ring-1 ring-slate-300`}
                onClick={() => { setRenderError(false); setRenderKey((k) => k + 1); }}
                data-testid="form-editor-retry-render">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {t("employment.forms.editor.retryRender")}
              </button>
            )}
          </div>
        )}
      </div>

      <section aria-label={t("employment.forms.editor.submitHeading")} className="max-h-[42vh] shrink-0 overflow-y-auto border-t border-slate-300 bg-white px-4 py-3 sm:px-6">
        <form onSubmit={onSubmit} className="mx-auto max-w-5xl space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-sm font-semibold text-slate-900">{t("employment.forms.editor.submitHeading")}</h3>
            <p className="text-xs text-slate-500">{t("employment.forms.editor.emailDestination", { address: "admin@marvolenterprises.com" })}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-medium text-slate-600">
              {t("employment.fields.firstName")} *
              <input value={firstName} onChange={event => setFirstName(event.target.value)} required maxLength={100}
                autoComplete="given-name" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
            </label>
            <label className="text-xs font-medium text-slate-600">
              {t("employment.fields.lastName")} *
              <input value={lastName} onChange={event => setLastName(event.target.value)} required maxLength={100}
                autoComplete="family-name" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
            </label>
            <label className="text-xs font-medium text-slate-600">
              {t("employment.fields.email")} *
              <input type="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={320}
                autoComplete="email" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
            </label>
            <label className="text-xs font-medium text-slate-600">
              {t("employment.fields.phone")}
              <input type="tel" value={phone} onChange={event => setPhone(event.target.value)} maxLength={50}
                autoComplete="tel" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Upload className="h-4 w-4" aria-hidden="true" />
              {t("employment.forms.editor.addIdPhotos")}
              <input ref={photoPicker} type="file" accept="image/jpeg,image/png,image/webp" multiple
                className="sr-only" onChange={event => onPhotoSelect(event.target.files)} />
            </label>
            {idPhotoFiles.length > 0 && (
              <span className="min-w-0 truncate text-xs text-slate-500">
                {t("employment.forms.editor.photosSelected", { count: idPhotoFiles.length, names: idPhotoFiles.map(file => file.name).join(", ") })}
              </span>
            )}
            <button type="submit" disabled={!doc || busy !== null}
              className="ml-auto inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              data-testid="form-editor-submit">
              {busy === "submit" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
              {t("employment.forms.editor.submitToMarvol")}
            </button>
          </div>
        </form>
      </section>

      {confirmClose && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="form-discard-title" data-testid="form-editor-confirm"
          className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h3 id="form-discard-title" className="font-semibold text-slate-900">{t("employment.forms.editor.discardTitle")}</h3>
            <p className="mt-2 text-sm text-slate-600">{t("employment.forms.editor.discardBody")}</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" autoFocus className={`${BTN} bg-emerald-600 text-white hover:bg-emerald-700`}
                onClick={() => setConfirmClose(false)} data-testid="form-editor-keep">{t("employment.forms.editor.keepEditing")}</button>
              <button type="button" className={`${BTN} border border-red-300 text-red-700 hover:bg-red-50`}
                onClick={onClose} data-testid="form-editor-discard">{t("employment.forms.editor.discard")}</button>
            </div>
          </div>
        </div>
      )}
      <PdfPrintPreview
        open={printPreviewOpen}
        title={title}
        document={doc}
        onOpenChange={setPrintPreviewOpen}
        testId="form-editor-preview"
      />
    </div>
  );
}
