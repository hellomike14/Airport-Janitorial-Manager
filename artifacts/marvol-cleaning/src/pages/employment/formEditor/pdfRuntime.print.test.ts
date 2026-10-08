import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { preparePdfPrintDocument } from "./pdfRuntime";

const originalToDataURL = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "toDataURL");
const originalImageDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "decode");

function createDocument(pageCount: number, renderedPages: number[]) {
  return {
    numPages: pageCount,
    getPage: async (pageNumber: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({
        width: 600 * scale,
        height: 780 * scale,
      }),
      render: () => ({
        promise: Promise.resolve().then(() => {
          renderedPages.push(pageNumber);
        }),
        cancel: vi.fn(),
      }),
      cleanup: vi.fn(),
    }),
  } as never;
}

beforeEach(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
    configurable: true,
    value: vi.fn(() => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/sWQAAAAASUVORK5CYII="),
  });
  Object.defineProperty(HTMLImageElement.prototype, "decode", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(() => {
  if (originalToDataURL) {
    Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", originalToDataURL);
  } else {
    Reflect.deleteProperty(HTMLCanvasElement.prototype, "toDataURL");
  }
  if (originalImageDecode) {
    Object.defineProperty(HTMLImageElement.prototype, "decode", originalImageDecode);
  } else {
    Reflect.deleteProperty(HTMLImageElement.prototype, "decode");
  }
});

test("print preparation waits for every PDF page image and never prints automatically", async () => {
  const renderedPages: number[] = [];
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const childDocument = frame.contentDocument!;
  const childImagePrototype = Object.getPrototypeOf(childDocument.createElement("img"));
  Object.defineProperty(childImagePrototype, "decode", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(frame.contentWindow!, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0),
  });
  const print = vi.fn();
  Object.defineProperty(frame, "contentWindow", {
    configurable: true,
    value: { focus: vi.fn(), print },
  });

  try {
    const prepared = await preparePdfPrintDocument(createDocument(3, renderedPages), frame);
    expect(renderedPages).toEqual([1, 2, 3]);
    expect(prepared.pageCount).toBe(3);
    expect(frame.contentDocument?.querySelectorAll("img")).toHaveLength(3);
    expect(frame.contentDocument?.querySelector("img[alt='Page 3 of 3']")).toBeTruthy();
    expect(print).not.toHaveBeenCalled();

    prepared.print();
    expect(print).toHaveBeenCalledTimes(1);
  } finally {
    frame.remove();
  }
});

test("an aborted page render cancels the active renderer and rejects preparation", async () => {
  const controller = new AbortController();
  let rejectRender: ((error: Error) => void) | undefined;
  const renderTask = {
    promise: new Promise<void>((_resolve, reject) => { rejectRender = reject; }),
    cancel: vi.fn(() => rejectRender?.(new DOMException("Cancelled", "AbortError"))),
  };
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 780 * scale }),
    render: () => renderTask,
    cleanup: vi.fn(),
  };
  const doc = { numPages: 1, getPage: async () => page } as never;
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);

  const pending = preparePdfPrintDocument(doc, frame, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toBeTruthy();
  expect(renderTask.cancel).toHaveBeenCalled();
  frame.remove();
});
