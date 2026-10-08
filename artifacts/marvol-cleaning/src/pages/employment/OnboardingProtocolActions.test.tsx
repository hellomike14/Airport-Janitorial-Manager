import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OnboardingProtocolActions } from "./OnboardingProtocolActions";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const PROTECTED_URL = "/api/onboarding-protocol";
const PDF_FILENAME = "Marvol_Employee_Onboarding_Protocol_v1.pdf";
const originalNavigatorShare = Object.getOwnPropertyDescriptor(navigator, "share");
const originalNavigatorCanShare = Object.getOwnPropertyDescriptor(navigator, "canShare");
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

let fetchMock: ReturnType<typeof vi.fn>;

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

test("offers protected email, copy, and PDF attachment fallbacks", async () => {
  setNativeShare(false);
  render(<OnboardingProtocolActions protectedUrl={PROTECTED_URL} />);

  fireEvent.click(screen.getByTestId("share-onboarding-protocol"));
  await screen.findByRole("dialog");

  expect(screen.queryByTestId("native-share-onboarding-protocol")).toBeNull();
  expect(screen.getByTestId("email-onboarding-protocol-link").getAttribute("href"))
    .toContain(encodeURIComponent(`${window.location.origin}${PROTECTED_URL}`));
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

test("shows a copyable protected link when clipboard access fails", async () => {
  setNativeShare(false);
  render(<OnboardingProtocolActions protectedUrl={PROTECTED_URL} />);

  fireEvent.click(screen.getByTestId("share-onboarding-protocol"));
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByTestId("copy-onboarding-protocol-link"));

  expect(await screen.findByDisplayValue(`${window.location.origin}${PROTECTED_URL}`)).toBeTruthy();
});

test("prints the prepared PDF iframe rather than the surrounding page", async () => {
  render(<OnboardingProtocolActions protectedUrl={PROTECTED_URL} />);

  fireEvent.click(screen.getByTestId("print-onboarding-protocol"));
  const frame = await screen.findByTestId("onboarding-protocol-pdf-preview");
  const framePrint = vi.fn();
  const frameWindow = { focus: vi.fn(), print: framePrint } as unknown as Window;
  Object.defineProperty(frame, "contentWindow", { configurable: true, value: frameWindow });
  fireEvent.load(frame);

  fireEvent.click(await screen.findByTestId("print-prepared-onboarding-protocol"));
  expect(framePrint).toHaveBeenCalledTimes(1);
});

test("offers the protected PDF when printing the preview fails", async () => {
  render(<OnboardingProtocolActions protectedUrl={PROTECTED_URL} />);

  fireEvent.click(screen.getByTestId("print-onboarding-protocol"));
  const frame = await screen.findByTestId("onboarding-protocol-pdf-preview");
  const frameWindow = {
    focus: vi.fn(),
    print: vi.fn(() => {
      throw new Error("Printing is unavailable");
    }),
  } as unknown as Window;
  Object.defineProperty(frame, "contentWindow", { configurable: true, value: frameWindow });
  fireEvent.load(frame);
  fireEvent.click(await screen.findByTestId("print-prepared-onboarding-protocol"));

  expect(await screen.findByTestId("onboarding-protocol-print-fallback")).toBeTruthy();
  expect(screen.getByTestId("onboarding-protocol-open-pdf").getAttribute("href")).toBe(PROTECTED_URL);
});

test("shows a localized error when the authenticated request has expired", async () => {
  fetchMock.mockResolvedValueOnce(pdfResponse({ status: 401 }));
  render(<OnboardingProtocolActions protectedUrl={PROTECTED_URL} />);

  fireEvent.click(screen.getByTestId("share-onboarding-protocol"));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByTestId("onboarding-protocol-feedback").textContent)
    .toBe("employment.onboarding.protocol.actions.sessionExpired");
});
