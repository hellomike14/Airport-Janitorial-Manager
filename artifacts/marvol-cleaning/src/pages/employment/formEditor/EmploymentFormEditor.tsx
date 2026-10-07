import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Download, Loader2, Minus, Plus, Printer, RefreshCw, X } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { fetchFormBytes, type EmploymentFormId } from "./formSources";
import { downloadBytes, openDocument, printDocument } from "./pdfRuntime";
import { PdfPage } from "./PdfPage";

interface Props {
  formId: EmploymentFormId;
  title: string;
  onClose: () => void;
}

const BTN = "inline-flex min-h-[40px] items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50";

export default function EmploymentFormEditor({ formId, title, onClose }: Props) {
  const { t } = useTranslation();
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [renderError, setRenderError] = useState(false);
  const [renderKey, setRenderKey] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [dirty, setDirty] = useState(false);
  const editRevision = useRef(0);
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState<"save" | "print" | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [current, setCurrent] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

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
  const onPrint = async () => {
    setBusy("print"); setNotice(null);
    try { if (!doc) throw new Error("no document"); await printDocument(doc); }
    catch { setNotice({ kind: "err", text: t("employment.forms.editor.printError") }); }
    finally { setBusy(null); }
  };
  const requestClose = () => (dirty ? setConfirmClose(true) : onClose());

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !confirmClose) requestClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const pages = doc ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : [];

  return (
    <div role="dialog" aria-modal="true" aria-label={title} data-testid="form-editor"
      className="fixed inset-0 z-[80] flex flex-col bg-slate-200">
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
          {busy === "print" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Printer className="h-4 w-4" aria-hidden="true" />}
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
    </div>
  );
}
