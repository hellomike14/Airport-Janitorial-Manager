import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import EmploymentFormEditor from "./EmploymentFormEditor";

const mocks = vi.hoisted(() => ({
  saveDocument: vi.fn(),
  submit: vi.fn(),
  upload: vi.fn(),
  destroy: vi.fn(),
  preparePrint: vi.fn(),
  printNow: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useSubmitEmploymentForm: () => ({ mutateAsync: mocks.submit }),
}));
vi.mock("./formSources", () => ({
  fetchFormBytes: async () => new Uint8Array([37, 80, 68, 70, 45]),
}));
vi.mock("./privateUpload", () => ({
  uploadEmploymentFormFile: mocks.upload,
}));
vi.mock("./pdfRuntime", () => ({
  downloadBytes: vi.fn(),
  openDocument: async () => ({
    task: { destroy: mocks.destroy },
    doc: { numPages: 1, saveDocument: mocks.saveDocument },
  }),
  loadPdfjs: async () => ({ AnnotationMode: { ENABLE_STORAGE: 1 } }),
  preparePdfPrintDocument: mocks.preparePrint,
}));
vi.mock("./PdfPage", () => ({ PdfPage: () => <div data-testid="mock-pdf-page" /> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function ClosingEditor({ onSubmitted }: { onSubmitted: (sent: boolean) => void }) {
  const [open, setOpen] = useState(true);
  return open
    ? <EmploymentFormEditor formId="i-9" title="Form I-9" onClose={() => setOpen(false)}
        onSubmitted={(sent) => { onSubmitted(sent); setOpen(false); }} />
    : <p data-testid="submission-complete" />;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  mocks.saveDocument.mockReset().mockResolvedValue(new Uint8Array([37, 80, 68, 70, 45, 49]));
  mocks.submit.mockReset().mockResolvedValue({ success: true, emailSent: true });
  mocks.preparePrint.mockReset().mockResolvedValue({ pageCount: 1, print: mocks.printNow });
  mocks.printNow.mockReset();
  mocks.upload.mockReset().mockImplementation(async (file: File) => ({
    name: file.name,
    path: `/objects/uploads/${file.name}`,
    contentType: file.type,
    uploadToken: "synthetic-upload-token",
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("filled form pages are prepared first and print only after a separate user click", async () => {
  render(<EmploymentFormEditor formId="i-9" title="Form I-9" onClose={() => {}} onSubmitted={() => {}} />);
  await screen.findByTestId("form-editor-print");
  await waitFor(() => expect((screen.getByTestId("form-editor-print") as HTMLButtonElement).disabled).toBe(false));

  fireEvent.click(screen.getByTestId("form-editor-print"));
  await waitFor(() => expect(mocks.preparePrint).toHaveBeenCalledTimes(1));
  expect(await screen.findByTestId("form-editor-preview-pages")).toBeTruthy();
  expect(mocks.preparePrint).toHaveBeenCalledWith(
    expect.objectContaining({ numPages: 1 }),
    expect.any(HTMLIFrameElement),
    expect.objectContaining({
      annotationMode: 1,
      signal: expect.any(AbortSignal),
      title: "Form I-9",
    }),
  );
  expect(mocks.printNow).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId("form-editor-preview-print"));
  expect(mocks.printNow).toHaveBeenCalledTimes(1);
});

test("submitting the edited PDF and ID photos stores contact details and clears the editor after the receipt", async () => {
  const onSubmitted = vi.fn();
  render(<ClosingEditor onSubmitted={onSubmitted} />);

  await screen.findByTestId("form-editor-submit");
  fireEvent.change(screen.getByLabelText(/employment\.fields\.firstName/), { target: { value: "Sample" } });
  fireEvent.change(screen.getByLabelText(/employment\.fields\.lastName/), { target: { value: "Applicant" } });
  fireEvent.change(screen.getByLabelText(/employment\.fields\.email/), { target: { value: "sample@example.invalid" } });
  const photoPicker = screen.getByLabelText(/employment\.forms\.editor\.addIdPhotos/);
  fireEvent.change(photoPicker, {
    target: { files: [new File(["synthetic ID photo"], "id-card.jpg", { type: "image/jpeg" })] },
  });

  fireEvent.click(screen.getByTestId("form-editor-submit"));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
  const submission = mocks.submit.mock.calls[0]?.[0] as { data: Record<string, unknown> };
  expect(submission.data).toMatchObject({
    formId: "i-9",
    firstName: "Sample",
    lastName: "Applicant",
    email: "sample@example.invalid",
  });
  expect(submission.data.completedPdf).toMatchObject({ contentType: "application/pdf" });
  expect(submission.data.idPhotos).toEqual([expect.objectContaining({ name: "id-card.jpg", contentType: "image/jpeg" })]);
  expect(onSubmitted).toHaveBeenCalledWith(true);
  expect(await screen.findByTestId("submission-complete")).toBeTruthy();
  expect(screen.queryByTestId("form-editor")).toBeNull();
  expect(mocks.saveDocument).toHaveBeenCalledTimes(1);
  expect(mocks.upload).toHaveBeenCalledTimes(2);
});
