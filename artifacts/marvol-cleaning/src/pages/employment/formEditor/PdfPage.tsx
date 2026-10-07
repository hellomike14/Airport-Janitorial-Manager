import { useEffect, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import "./PdfPage.css";
import { linkService, loadPdfjs } from "./pdfRuntime";

interface Props {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  label: string;
  fieldLabel: (n: number) => string;
  onError: (e: unknown) => void;
}

/** Labels any form control PDF.js emitted without an accessible name. */
function labelControls(root: HTMLElement, fallback: (n: number) => string) {
  let n = 0;
  root.querySelectorAll<HTMLElement>("input, select, textarea").forEach((el) => {
    n += 1;
    if (!el.matches(":disabled")) el.closest("section")?.classList.add("marvol-editable-widget");
    if (el.getAttribute("aria-label")) return;
    const text = el.getAttribute("title") || el.getAttribute("name") || fallback(n);
    el.setAttribute("aria-label", text);
  });
}

export function PdfPage({ doc, pageNumber, scale, label, fieldLabel, onError }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const errRef = useRef(onError);
  errRef.current = onError;
  const fieldLabelRef = useRef(fieldLabel);
  fieldLabelRef.current = fieldLabel;

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    (async () => {
      try {
        const lib = await loadPdfjs();
        const page = await doc.getPage(pageNumber);
        if (cancelled || !wrap.current || !canvas.current || !layer.current) return;
        const viewport = page.getViewport({ scale });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const c = canvas.current;
        c.width = Math.floor(viewport.width * dpr);
        c.height = Math.floor(viewport.height * dpr);
        c.style.width = `${Math.floor(viewport.width)}px`;
        c.style.height = `${Math.floor(viewport.height)}px`;
        wrap.current.style.width = `${Math.floor(viewport.width)}px`;
        wrap.current.style.height = `${Math.floor(viewport.height)}px`;
        wrap.current.style.setProperty("--scale-factor", String(scale));
        wrap.current.style.setProperty("--total-scale-factor", String(scale));
        // PDF.js 6 draws widget appearance states into separate canvases.
        // The layer chooses the correct state; without this map both can
        // be painted onto the page bitmap (e.g. unchecked W-4 boxes look checked).
        const annotationCanvasMap = new Map<string, HTMLCanvasElement>();
        task = page.render({
          canvas: c,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          // Widgets are drawn by the interactive layer, not baked into the bitmap.
          annotationMode: lib.AnnotationMode.ENABLE_FORMS,
          annotationCanvasMap,
        });
        await task.promise;
        if (cancelled || !layer.current) return;
        const annotations = await page.getAnnotations({ intent: "display" });
        if (cancelled || !layer.current) return;
        const div = layer.current;
        div.replaceChildren();
        const flat = viewport.clone({ dontFlip: true });
        const al = new lib.AnnotationLayer({
          div, accessibilityManager: null, annotationCanvasMap, annotationEditorUIManager: null,
          page, viewport: flat, structTreeLayer: null, commentManager: null,
          linkService, annotationStorage: doc.annotationStorage,
        });
        await al.render({
          annotations, div, viewport: flat, page, linkService: linkService as never,
          annotationStorage: doc.annotationStorage, renderForms: true,
          enableScripting: false, hasJSActions: false, fieldObjects: null,
        } as never);
        // The standalone editor does not inherit PDFViewer's CSS rounding
        // variables. Explicit dimensions keep percentage-positioned widgets
        // aligned with the page instead of collapsing at its top-left.
        div.style.width = `${viewport.width}px`;
        div.style.height = `${viewport.height}px`;
        labelControls(div, (n) => `${fieldLabelRef.current(n)} (${pageNumber})`);
      } catch (e) {
        const name = (e as { name?: string })?.name;
        if (cancelled || name === "RenderingCancelledException") return;
        errRef.current(e);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber, scale]);

  return (
    <div
      ref={wrap}
      role="group"
      aria-label={label}
      data-testid={`form-page-${pageNumber}`}
      data-page-number={pageNumber}
      className="pdf-form-page relative mx-auto bg-white shadow-lg ring-1 ring-slate-300"
      style={{ width: 612 * scale, height: 792 * scale }}
    >
      <canvas ref={canvas} className="absolute inset-0 block" aria-hidden="true" />
      <div ref={layer} className="annotationLayer" />
    </div>
  );
}
