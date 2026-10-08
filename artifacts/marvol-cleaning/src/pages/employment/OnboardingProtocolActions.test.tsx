import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OnboardingProtocolActions } from "./OnboardingProtocolActions";

const pdfRuntime = vi.hoisted(() => ({
  openDocument: vi.fn(),
  preparePdfPrintDocument: vi.fn(),
}));

vi.mock("./formEditor/pdfRuntime", () => pdfRuntime);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const PROTECTED_URL = "/api/onboarding-protocol";
const PDF_FILENAME = "Marvol_Employee_Onboarding_Protocol_v1.pdf";
const originalNavigatorShare = Object.getOwnPropertyDescriptor(navigator, "share");
const originalNavigatorCanShare = Object.getOwnPropertyDescriptor(navigator, "canShare");
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

let fetchMock: ReturnType<typeof vi.fn>;
let printCalls: number;
let printMock: () => void;

function pdfResponse({
  status = 200,
  contentType = "application/pdf",
  bytes = new TextEncoder().encode("%PDF-1.7\nprotocol").buffer,
}: {
  status?: number;
  contentType?: string;
  bytes?: ArrayBuffer;
} = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => name.toLowerCase() === "content-type" ? contentType : null },
    arrayBuffer: async () => bytes,
    json: async () => ({ accepted: true }),
  };
}

function setNativeShare(canShare: boolean, share = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, "canShare", {
    configurable: true,
    value: vi.fn(() => canShare),
  });
  Object.defineProperty(navigator, "share", { configurable: true, value: share });
  return share;
}

function restoreProperty(target: object, key: PropertyKey, descriptor?: PropertyDescriptor) {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(pdfResponse());
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:onboarding-protocol-test"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });

  printCalls = 0;
  printMock = () => { printCalls++; };
  const task = { destroy: vi.fn().mockResolvedValue(undefined) };
  pdfRuntime.openDocument.mockResolvedValue({ task, doc: { numPages: 3 } });
  pdfRuntime.preparePdfPrintDocument.mockResolvedValue({ pageCount: 3, print: printMock });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  restoreProperty(navigator, "share", originalNavigatorShare);
  restoreProperty(navigator, "canShare", originalNavigatorCanShare);
  restoreProperty(navigator, "clipboard", originalClipboard);
  restoreProperty(URL, "createObjectURL", originalCreateObjectURL);
  restoreProperty(URL, "revokeObjectURL", originalRevokeObjectURL);
});

test("prepares the authenticated PDF before enabling a fresh native-share click", async () => {
  const share = setNativeShare(true);
  render(<OnboardingProtocolActions protectedUrl={PROTECTED_URL} />);

  fireEvent.click(screen.getByTestId("share-onboarding-protocol"));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledWith(PROTECTED_URL, expect.objectContaining({
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/pdf" },
  }));
  expect(share).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId("native-share-onboarding-protocol"));
  await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
  const shareData = share.mock.calls[0][0];
  expect(shareData.files?.[0]).toBeInstanceOf(File);
  expect(shareData.files?.[0].name).toBe(PDF_FILENAME);
});

test("cancelling the native share sheet stays quiet and leaves the dialog usable", async () => {
  const share = setNativeShare(true, vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError")));
  render(<OnboardingProtocolActions protectedUrl={PROTECTED_URL} />);

  fireEvent.click(screen.getByTestId("share-onboarding-protocol"));
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByTestId("native-share-onboarding-protocol"));
  await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("offers protected copy and local PDF download fallbacks without a mailto link", async () => {
  setNativeShare(false);
  render(<OnboardingProtocolActions protectedUrl={PROTECTED_URL} />);

  fireEvent.click(screen.getByTestId("share-onboarding-protocol"));
  await screen.findByRole("dialog");

  expect(screen.queryByTestId("native-share-onboarding-protocol")).toBeNull();
  expect(screen.queryByTestId("email-onboarding-protocol-link")).toBeNull();
  expect(screen.getByTestId("copy-onboarding-protocol-link")).toBeTruthy();

  const downloadedLinks: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloadedLinks.push(this);
  });
  fireEvent.click(screen.getByTestId("download-onboarding-protocol-attachment"));

  expect(downloadedLinks).toHaveLength(1);
  expect(downloadedLinks[0].download).toBe(PDF_FILENAME);
  expect(downloadedLinks[0].href).toBe("blob:onboarding-protocol-test");
});

test("admin email composer sends only the recipient and relies on same-origin session cookies", async () => {
  fetchMock.mockResolvedValueOnce(pdfResponse({
    status: 202,
    contentType: "application/json",
  }));
  render(<OnboardingProtocolActions protectedUrl={PROTECTED_URL} canEmailProtocol />);

  fireEvent.click(screen.getByTestId("email-onboarding-protocol"));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  const input = screen.getByTestId("onboarding-protocol-recipient");
  fireEvent.change(input, { target: { value: "operations@example.com" } });
  fireEvent.click(screen.getByTestId("send-onboarding-protocol-email"));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe(new URL(`${PROTECTED_URL}/email`, window.location.origin).toString());
  expect(request).toMatchObject({
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ recipientEmail: "operations@example.com" }),
  });
  expect(Object.keys(request.headers as Record<string, string>).some((key) => key.toLowerCase() === "authorization"))
    .toBe(false);
  expect(await screen.findByTestId("onboarding-protocol-email-feedback")).toBeTruthy();
  expect(screen.getByTestId("onboarding-protocol-email-feedback").textContent)
    .toBe("employment.onboarding.protocol.actions.emailAccepted");
  expect(screen.getByTestId("send-another-onboarding-protocol-email")).toBeTruthy();
});

test("email composer is not shown to roles without the admin capability", () => {
  render(<OnboardingProtocolActions protectedUrl={PROTECTED_URL} />);
  expect(screen.queryByTestId("email-onboarding-protocol")).toBeNull();
});

test("email session expiry and provider errors are shown without a success message", async () => {
  fetchMock.mockResolvedValueOnce(pdfResponse({ status: 401, contentType: "application/json" }));
  render(<OnboardingProtocolActions protectedUrl={PROTECTED_URL} canEmailProtocol />);
  fireEvent.click(screen.getByTestId("email-onboarding-protocol"));
  await screen.findByRole("dialog");
  fireEvent.change(screen.getByTestId("onboarding-protocol-recipient"), {
    target: { value: "operations@example.com" },
  });
  fireEvent.click(screen.getByTestId("send-onboarding-protocol-email"));

  const message = await screen.findByTestId("onboarding-protocol-email-feedback");
  expect(message.textContent).toBe("employment.onboarding.protocol.actions.sessionExpired");
  expect(screen.queryByTestId("send-another-onboarding-protocol-email")).toBeNull();
});

test("copy fallback exposes the protected URL if clipboard access fails", async () => {
  setNativeShare(false);
  render(<OnboardingProtocolActions protectedUrl={PROTECTED_URL} />);

  fireEvent.click(screen.getByTestId("share-onboarding-protocol"));
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByTestId("copy-onboarding-protocol-link"));

  expect(await screen.findByDisplayValue(`${window.location.origin}${PROTECTED_URL}`)).toBeTruthy();
});

test("print is unavailable until PDF.js prepares every page, then runs in the click handler", async () => {
  let releasePreparation: ((value: { pageCount: number; print: () => void }) => void) | undefined;
  pdfRuntime.preparePdfPrintDocument.mockReturnValueOnce(
    new Promise((resolve) => { releasePreparation = resolve; }),
  );
  render(<OnboardingProtocolActions protectedUrl={PROTECTED_URL} />);

  fireEvent.click(screen.getByTestId("print-onboarding-protocol"));
  const frame = await screen.findByTestId("onboarding-protocol-pdf-preview");
  await waitFor(() => expect(pdfRuntime.preparePdfPrintDocument).toHaveBeenCalledTimes(1));
  expect(frame.getAttribute("src")).toBeNull();
  expect(screen.queryByTestId("print-prepared-onboarding-protocol")).toBeNull();

  releasePreparation?.({ pageCount: 3, print: printMock });
  const printButton = await screen.findByTestId("print-prepared-onboarding-protocol");
  fireEvent.click(printButton);
  expect(printCalls).toBe(1);
  expect(screen.getByText("employment.onboarding.protocol.actions.previewReady")).toBeTruthy();
});

test("renders an accessible protected open/download fallback when PDF.js cannot prepare printing", async () => {
  pdfRuntime.preparePdfPrintDocument.mockRejectedValueOnce(new Error("PDF rendering failed"));
  render(<OnboardingProtocolActions protectedUrl={PROTECTED_URL} />);

  fireEvent.click(screen.getByTestId("print-onboarding-protocol"));
  expect(await screen.findByTestId("onboarding-protocol-print-fallback")).toBeTruthy();
  expect(screen.getByTestId("onboarding-protocol-open-pdf").getAttribute("href")).toBe(
    new URL(PROTECTED_URL, window.location.origin).toString(),
  );
  expect(screen.getByTestId("onboarding-protocol-download-fallback").getAttribute("href"))
    .toBe(`${new URL(PROTECTED_URL, window.location.origin).toString()}?download=1`);
});

test("shows a localized error when the authenticated PDF request has expired", async () => {
  fetchMock.mockResolvedValueOnce(pdfResponse({ status: 401 }));
  render(<OnboardingProtocolActions protectedUrl={PROTECTED_URL} />);

  fireEvent.click(screen.getByTestId("share-onboarding-protocol"));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByTestId("onboarding-protocol-feedback").textContent)
    .toBe("employment.onboarding.protocol.actions.sessionExpired");
});
