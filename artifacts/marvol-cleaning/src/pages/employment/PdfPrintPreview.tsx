import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { useTranslation } from "react-i18next";
import { Loader2, Printer, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  loadPdfjs,
  openDocument,
  preparePdfPrintDocument,
  type PreparedPdfPrintDocument,
} from "./formEditor/pdfRuntime";

type Props = {
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  bytes?: Uint8Array | null;
  document?: PDFDocumentProxy | null;
  testId: string;
};

export function PdfPrintPreview({
  open,
  title,
  onOpenChange,
  bytes = null,
  document = null,
  testId,
}: Props) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const preparedRef = useRef<PreparedPdfPrintDocument | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [pageCount, setPageCount] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const attachFrame = useCallback((frame: HTMLIFrameElement | null) => {
    frameRef.current = frame;
    setFrameReady(Boolean(frame));
  }, []);

  useEffect(() => {
    if (!open) {
      preparedRef.current = null;
      setState("loading");
      setPageCount(0);
      return;
    }
    const frame = frameReady ? frameRef.current : null;
    if (!frame || (!document && !bytes)) return;

    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    const controller = new AbortController();
    setState("loading");
    preparedRef.current = null;

    const prepare = async () => {
      try {
        let pdfDocument = document;
        if (!pdfDocument && bytes) {
          const opened = await openDocument(bytes);
          loadingTask = opened.task;
          pdfDocument = opened.doc;
        }
        if (!pdfDocument || cancelled) return;
        const lib = await loadPdfjs();
        const prepared = await preparePdfPrintDocument(pdfDocument, frame, {
          annotationMode: lib.AnnotationMode.ENABLE_STORAGE,
          signal: controller.signal,
          title,
        });
        if (cancelled) return;
        preparedRef.current = prepared;
        setPageCount(prepared.pageCount);
        setState("ready");
      } catch {
        if (!cancelled) setState("failed");
      } finally {
        if (loadingTask) {
          try {
            await loadingTask.destroy();
          } catch {
            // The print preview is composed of independent page images.
          }
          loadingTask = null;
        }
      }
    };

    void prepare();
    return () => {
      cancelled = true;
      controller.abort();
      preparedRef.current = null;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [open, title, bytes, document, attempt, frameReady]);

  const handlePrint = () => {
    const prepared = preparedRef.current;
    if (!prepared || state !== "ready") {
      setState("failed");
      return;
    }
    try {
      // Printing only starts from this explicit user click; all pages are ready first.
      prepared.print();
    } catch {
      setState("failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-1rem)] max-w-4xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="pr-8">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("employment.forms.documentActions.printDescription")}</DialogDescription>
        </DialogHeader>
        {state === "loading" ? (
          <p role="status" data-testid={`${testId}-loading`} className="flex items-center gap-2 py-5 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("employment.forms.documentActions.preparing")}
          </p>
        ) : state === "failed" ? (
          <div role="alert" data-testid={`${testId}-error`} className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            <p>{t("employment.forms.documentActions.previewFailed")}</p>
            <button type="button" onClick={() => setAttempt((current) => current + 1)} className="mt-2 underline">
              {t("employment.forms.documentActions.retry")}
            </button>
          </div>
        ) : null}
        {state === "ready" && (
          <p role="status" data-testid={`${testId}-pages`} className="text-sm text-slate-600">
            {t("employment.forms.documentActions.pageCount", { count: pageCount })}
          </p>
        )}
        <iframe
          ref={attachFrame}
          title={t("employment.forms.documentActions.previewTitle", { title })}
          data-testid={`${testId}-frame`}
          className={`${state === "ready" ? "block" : "hidden"} h-[62dvh] w-full rounded-lg border border-slate-200 bg-slate-100`}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => onOpenChange(false)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <X className="h-4 w-4" aria-hidden="true" />
            {t("employment.forms.documentActions.close")}
          </button>
          <button type="button" onClick={handlePrint} disabled={state !== "ready"}
            data-testid={`${testId}-print`}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-50">
            {state === "loading"
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <Printer className="h-4 w-4" aria-hidden="true" />}
            {t("employment.forms.documentActions.printNow")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
