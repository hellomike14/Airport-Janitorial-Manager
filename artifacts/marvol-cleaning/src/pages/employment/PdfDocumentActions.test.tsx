import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PdfDocumentActions } from "./PdfDocumentActions";

const pdfRuntime = vi.hoisted(() => ({
  openDocument: vi.fn(),
  loadPdfjs: vi.fn(),
  preparePdfPrintDocument: vi.fn(),
}));

vi.mock("./formEditor/pdfRuntime", () => pdfRuntime);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key }),
}));

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nsynthetic blank and filled fields");
let fetchMock: ReturnType<typeof vi.fn>;
let printMock: ReturnType<typeof vi.fn>;

function response({
  status = 200,
  contentType = "application/pdf",
  accepted = true,
}: { status?: number; contentType?: string; accepted?: boolean } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => name.toLowerCase() === "content-type" ? contentType : null },
    arrayBuffer: async () => PDF_BYTES.slice().buffer,
    json: async () => ({ accepted }),
  };
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(response());
  vi.stubGlobal("fetch", fetchMock);
  printMock = vi.fn();
  const task = { destroy: vi.fn().mockResolvedValue(undefined) };
  pdfRuntime.openDocument.mockResolvedValue({ task, doc: { numPages: 2 } });
  pdfRuntime.loadPdfjs.mockResolvedValue({ AnnotationMode: { ENABLE_STORAGE: 42 } });
  pdfRuntime.preparePdfPrintDocument.mockResolvedValue({ pageCount: 2, print: printMock });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  pdfRuntime.openDocument.mockReset();
  pdfRuntime.loadPdfjs.mockReset();
  pdfRuntime.preparePdfPrintDocument.mockReset();
});

test("prepares every PDF page first and only prints after a separate user click", async () => {
  render(
    <PdfDocumentActions
      title="Blank Form"
      pdfUrl="/api/employment-forms/w-4"
      emailEndpoint="/api/employment-forms/w-4/email"
      testId="w4"
    />,
  );

  fireEvent.click(screen.getByTestId("w4-print-open"));
  expect(await screen.findByTestId("w4-preview-pages")).toBeTruthy();
  await waitFor(() => expect(pdfRuntime.preparePdfPrintDocument).toHaveBeenCalledTimes(1));
  expect(pdfRuntime.preparePdfPrintDocument).toHaveBeenCalledWith(
    expect.objectContaining({ numPages: 2 }),
    expect.any(HTMLIFrameElement),
    expect.objectContaining({ annotationMode: 42, title: "Blank Form" }),
  );
  expect(printMock).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId("w4-preview-print"));
  expect(printMock).toHaveBeenCalledTimes(1);
});

test("emails only the validated recipient request and reports provider acceptance", async () => {
  fetchMock.mockResolvedValueOnce(response({
    status: 202,
    contentType: "application/json",
  }));
  render(
    <PdfDocumentActions
      title="Blank Form"
      pdfUrl="/api/employment-forms/w-4"
      emailEndpoint="/api/employment-forms/w-4/email"
      testId="w4"
    />,
  );
  fireEvent.click(screen.getByTestId("w4-email"));
  const recipient = screen.getByTestId("w4-recipient") as HTMLInputElement;
  fireEvent.change(recipient, { target: { value: "worker@example.invalid" } });
  fireEvent.click(screen.getByTestId("w4-email-submit"));

  expect(await screen.findByText("employment.forms.documentActions.emailAccepted")).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe(`${window.location.origin}/api/employment-forms/w-4/email`);
  expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
    method: "POST",
    credentials: "include",
    body: JSON.stringify({ recipientEmail: "worker@example.invalid" }),
  }));
});

test("does not report success when the email provider rejects the request", async () => {
  fetchMock.mockResolvedValueOnce(response({
    status: 502,
    contentType: "application/json",
  }));
  render(
    <PdfDocumentActions
      title="Blank Form"
      pdfUrl="/api/employment-forms/w-4"
      emailEndpoint="/api/employment-forms/w-4/email"
      testId="w4"
    />,
  );
  fireEvent.click(screen.getByTestId("w4-email"));
  fireEvent.change(screen.getByTestId("w4-recipient"), { target: { value: "worker@example.invalid" } });
  fireEvent.click(screen.getByTestId("w4-email-submit"));

  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("employment.forms.documentActions.emailAccepted")).toBeNull();
});
