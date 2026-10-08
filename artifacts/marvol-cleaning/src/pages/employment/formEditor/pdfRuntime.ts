import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

export function loadPdfjs() {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = workerUrl;
    return lib;
  });
  return pdfjsPromise;
}

/** The loader takes ownership of the buffer, so always hand it a copy. */
export async function openDocument(bytes: Uint8Array): Promise<{ task: PDFDocumentLoadingTask; doc: PDFDocumentProxy }> {
  const lib = await loadPdfjs();
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
  const task = lib.getDocument({
    data: bytes.slice(),
    standardFontDataUrl: `${base}/pdfjs-standard-fonts/`,
  });
  try {
    return { task, doc: await task.promise };
  } catch (e) {
    void task.destroy();
    throw e;
  }
}

/** Minimal link service: forms need none, but AnnotationLayer calls into it. */
export const linkService = {
  externalLinkEnabled: false,
  eventBus: null,
  pagesCount: 0,
  page: 1,
  rotation: 0,
  isInPresentationMode: false,
  getDestinationHash: () => "#",
  getAnchorUrl: () => "#",
  addLinkAttributes(link: HTMLAnchorElement, url: string) {
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer nofollow";
  },
  goToDestination() {},
  goToPage() {},
  navigateTo() {},
  executeNamedAction() {},
  executeSetOCGState() {},
  isPageVisible: () => true,
  isPageCached: () => true,
  setHash() {},
};

export function downloadBytes(bytes: Uint8Array<ArrayBuffer>, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export type PreparedPdfPrintDocument = {
  pageCount: number;
  print: () => void;
};

export async function preparePdfPrintDocument(
  doc: PDFDocumentProxy,
  frame: HTMLIFrameElement,
  options: { annotationMode?: number; signal?: AbortSignal } = {},
): Promise<PreparedPdfPrintDocument> {
  const images: { src: string; width: number; height: number; page: number }[] = [];
  if (doc.numPages < 1) throw new Error("The PDF has no pages");

  for (let n = 1; n <= doc.numPages; n++) {
    if (options.signal?.aborted) throw new DOMException("Print preparation cancelled", "AbortError");
    const page = await doc.getPage(n);
    try {
      if (options.signal?.aborted) throw new DOMException("Print preparation cancelled", "AbortError");
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const parameters: Parameters<typeof page.render>[0] = {
        canvas,
        viewport,
        intent: "print",
      };
      if (options.annotationMode !== undefined) parameters.annotationMode = options.annotationMode;
      const renderTask = page.render(parameters);
      const cancelRender = () => renderTask.cancel();
      options.signal?.addEventListener("abort", cancelRender, { once: true });
      try {
        await renderTask.promise;
      } finally {
        options.signal?.removeEventListener("abort", cancelRender);
      }
      const pageSize = page.getViewport({ scale: 1 });
      images.push({
        src: canvas.toDataURL("image/png"),
        width: pageSize.width,
        height: pageSize.height,
        page: n,
      });
      canvas.width = 0;
      canvas.height = 0;
    } finally {
      page.cleanup();
    }
  }

  const first = images[0];
  const printDocument = frame.contentDocument;
  if (!first || !printDocument) throw new Error("Print frame is unavailable");
  printDocument.open();
  printDocument.write(`<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Marvol Employee Onboarding Protocol</title>
    <style>
      @page { size: ${first.width}pt ${first.height}pt; margin: 0; }
      html, body { margin: 0; padding: 0; }
      img { display: block; width: 100%; height: auto; page-break-after: always; break-after: page; }
      img:last-child { page-break-after: auto; break-after: auto; }
      @media screen { body { background: #e2e8f0; padding: 1rem; }
        img { width: min(100%, 8.5in); height: auto; margin: 0 auto 1rem; background: white;
          box-shadow: 0 1px 4px rgb(15 23 42 / 18%); } }
      @media print { body { padding: 0; } img { box-shadow: none; } }
    </style></head><body>
    ${images.map((image) =>
      `<img src="${image.src}" alt="Page ${image.page} of ${images.length}" data-page="${image.page}">`,
    ).join("")}
    </body></html>`);
  printDocument.close();

  const pageImages = Array.from(printDocument.images);
  await Promise.all(pageImages.map((image) => {
    if (typeof image.decode === "function") return image.decode();
    return new Promise<void>((resolve, reject) => {
      if (image.complete) {
        if (image.naturalWidth > 0) resolve();
        else reject(new Error("A rendered PDF page could not be loaded"));
        return;
      }
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error("A rendered PDF page could not be loaded")), { once: true });
    });
  }));
  if (printDocument.fonts?.ready) await printDocument.fonts.ready;
  await new Promise<void>((resolve) => {
    const view = printDocument.defaultView;
    if (view?.requestAnimationFrame) view.requestAnimationFrame(() => resolve());
    else window.setTimeout(resolve, 0);
  });

  if (pageImages.length !== doc.numPages) throw new Error("Print preview is missing one or more pages");
  return {
    pageCount: pageImages.length,
    print() {
      const view = frame.contentWindow;
      if (!view || typeof view.print !== "function") throw new Error("Printing is unsupported");
      view.focus();
      view.print();
    },
  };
}

/**
 * Prints EVERY page: re-renders each page with print intent and the live annotationStorage
 * into bitmaps, then prints them from a same-origin iframe (no native PDF plugin needed).
 */
export async function printDocument(doc: PDFDocumentProxy): Promise<void> {
  const lib = await loadPdfjs();
  const images: { src: string; w: number; h: number }[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({
      canvas, viewport, intent: "print",
      annotationMode: lib.AnnotationMode.ENABLE_STORAGE,
    }).promise;
    const base = page.getViewport({ scale: 1 });
    images.push({ src: canvas.toDataURL("image/png"), w: base.width, h: base.height });
    canvas.width = 0; canvas.height = 0;
    page.cleanup();
  }
  await new Promise<void>((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(frame);
    const idoc = frame.contentDocument;
    if (!idoc) { frame.remove(); reject(new Error("print frame unavailable")); return; }
    const first = images[0];
    idoc.open();
    idoc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Marvol form</title><style>
      @page { size: ${first.w}pt ${first.h}pt; margin: 0 }
      html,body{margin:0;padding:0}
      img{display:block;width:100%;height:auto;page-break-after:always;break-after:page}
      img:last-child{page-break-after:auto;break-after:auto}
    </style></head><body>${images.map((i) => `<img src="${i.src}" alt="">`).join("")}</body></html>`);
    idoc.close();
    const imgs = Array.from(idoc.images);
    Promise.all(imgs.map((im) => im.decode())).then(() => {
      try {
        const w = frame.contentWindow!;
        w.addEventListener("afterprint", () => setTimeout(() => frame.remove(), 500));
        w.focus();
        w.print();
        setTimeout(() => frame.remove(), 10 * 60_000);
        resolve();
      } catch (e) {
        frame.remove();
        reject(e);
      }
    }).catch((e) => { frame.remove(); reject(e); });
  });
}
