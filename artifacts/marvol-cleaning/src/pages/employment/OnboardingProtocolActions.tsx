import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, ExternalLink, Loader2, Link2, Mail, Printer, Share2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { openDocument, preparePdfPrintDocument, type PreparedPdfPrintDocument } from "./formEditor/pdfRuntime";

const PDF_FILENAME = "Marvol_Employee_Onboarding_Protocol_v1.pdf";
const PDF_FETCH_TIMEOUT_MS = 30_000;
const PDF_PRINT_TIMEOUT_MS = 60_000;
const EMAIL_SEND_TIMEOUT_MS = 35_000;

type PreparedPdf = { bytes: Uint8Array; file: File | null; url: string };
type Feedback = { key: string; error?: boolean };
type PdfFailure = "sessionExpired" | "invalidPdf" | "fetchTimeout" | "fetchFailed";

class PdfPreparationError extends Error {
  constructor(readonly kind: PdfFailure) {
    super(kind);
  }
}

function nativeFileSharingAvailable(file: File | null) {
  if (!file) return false;
  const shareApi = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
    share?: (data?: ShareData) => Promise<void>;
  };
  if (typeof shareApi.share !== "function" || typeof shareApi.canShare !== "function") return false;
  try {
    return shareApi.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function isShareCancellation(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

export function OnboardingProtocolActions({
  protectedUrl,
  canEmailProtocol = false,
}: {
  protectedUrl: string;
  canEmailProtocol?: boolean;
}) {
  const { t } = useTranslation();
  const [preparedUrl, setPreparedUrl] = useState<string | null>(null);
  const [nativeShareAvailable, setNativeShareAvailable] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailRecipient, setEmailRecipient] = useState("");
  const [emailFeedback, setEmailFeedback] = useState<Feedback | null>(null);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailAccepted, setEmailAccepted] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [previewPageCount, setPreviewPageCount] = useState(0);
  const [previewVersion, setPreviewVersion] = useState(0);

  const preparedPdfRef = useRef<PreparedPdf | null>(null);
  const pendingPreparationRef = useRef<Promise<PreparedPdf | null> | null>(null);
  const preparationControllerRef = useRef<AbortController | null>(null);
  const emailControllerRef = useRef<AbortController | null>(null);
  const preparedPrintRef = useRef<PreparedPdfPrintDocument | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      preparationControllerRef.current?.abort();
      emailControllerRef.current?.abort();
      preparedPrintRef.current = null;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!printPreviewOpen || !preparedUrl || !preparedPdfRef.current) return;
    const frame = iframeRef.current;
    if (!frame) return;

    let cancelled = false;
    let loadingTask: Awaited<ReturnType<typeof openDocument>>["task"] | null = null;
    let timedOut = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, PDF_PRINT_TIMEOUT_MS);

    const renderAllPages = async () => {
      try {
        const preparedPdf = preparedPdfRef.current;
        if (!preparedPdf) throw new Error("Prepared protocol PDF is unavailable");
        const opened = await openDocument(preparedPdf.bytes);
        loadingTask = opened.task;
        if (cancelled) return;
        if (controller.signal.aborted) throw new Error("Print preparation timed out");
        const printDocument = await preparePdfPrintDocument(opened.doc, frame, {
          signal: controller.signal,
        });
        if (cancelled) return;
        if (controller.signal.aborted) throw new Error("Print preparation timed out");
        preparedPrintRef.current = printDocument;
        setPreviewPageCount(printDocument.pageCount);
        setPreviewState("ready");
      } catch {
        if (cancelled) return;
        preparedPrintRef.current = null;
        setPreviewState("failed");
        setFeedback({
          key: timedOut
            ? "employment.onboarding.protocol.actions.printPreparationTimeout"
            : "employment.onboarding.protocol.actions.previewFailed",
          error: true,
        });
      } finally {
        window.clearTimeout(timeout);
        if (loadingTask) {
          try {
            await loadingTask.destroy();
          } catch {
            // The print preview already has independent page images.
          }
        }
      }
    };

    void renderAllPages();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
      preparedPrintRef.current = null;
    };
  }, [printPreviewOpen, preparedUrl, previewVersion]);

  const preparePdf = () => {
    if (preparedPdfRef.current) return Promise.resolve(preparedPdfRef.current);
    if (pendingPreparationRef.current) return pendingPreparationRef.current;

    const controller = new AbortController();
    preparationControllerRef.current = controller;
    let timedOut = false;
    setIsPreparing(true);
    setFeedback({ key: "employment.onboarding.protocol.actions.preparing" });

    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, PDF_FETCH_TIMEOUT_MS);

    const request = (async (): Promise<PreparedPdf | null> => {
      try {
        const response = await fetch(protectedUrl, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/pdf" },
          signal: controller.signal,
        });
        if (response.status === 401) throw new PdfPreparationError("sessionExpired");
        if (!response.ok) throw new PdfPreparationError("fetchFailed");

        const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
        if (contentType !== "application/pdf") throw new PdfPreparationError("invalidPdf");

        const bytes = new Uint8Array(await response.arrayBuffer());
        if (controller.signal.aborted) {
          if (timedOut) throw new PdfPreparationError("fetchTimeout");
          return null;
        }
        if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
          throw new PdfPreparationError("invalidPdf");
        }

        const blob = new Blob([bytes], { type: "application/pdf" });
        const file = typeof File === "undefined"
          ? null
          : new File([blob], PDF_FILENAME, { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        if (!mountedRef.current || controller.signal.aborted) {
          URL.revokeObjectURL(url);
          return null;
        }

        const prepared = { bytes, file, url };
        preparedPdfRef.current = prepared;
        objectUrlRef.current = url;
        setPreparedUrl(url);
        setNativeShareAvailable(nativeFileSharingAvailable(file));
        setCopyFailed(false);
        return prepared;
      } catch (error) {
        if (!mountedRef.current || (controller.signal.aborted && !timedOut)) return null;
        const key = timedOut
          ? "employment.onboarding.protocol.actions.fetchTimeout"
          : error instanceof PdfPreparationError
            ? `employment.onboarding.protocol.actions.${error.kind}`
            : "employment.onboarding.protocol.actions.fetchFailed";
        setFeedback({ key, error: true });
        return null;
      } finally {
        window.clearTimeout(timeout);
        if (preparationControllerRef.current === controller) preparationControllerRef.current = null;
        pendingPreparationRef.current = null;
        if (mountedRef.current) setIsPreparing(false);
      }
    })();

    pendingPreparationRef.current = request;
    return request;
  };

  const handleOpenShareDialog = () => {
    const prepared = preparedPdfRef.current;
    if (prepared) {
      const canShare = nativeFileSharingAvailable(prepared.file);
      setNativeShareAvailable(canShare);
      setFeedback({
        key: canShare
          ? "employment.onboarding.protocol.actions.shareReady"
          : "employment.onboarding.protocol.actions.fallbackReady",
      });
      setShareDialogOpen(true);
      return;
    }

    void preparePdf().then((result) => {
      if (!result || !mountedRef.current) return;
      const canShare = nativeFileSharingAvailable(result.file);
      setNativeShareAvailable(canShare);
      setFeedback({
        key: canShare
          ? "employment.onboarding.protocol.actions.shareReady"
          : "employment.onboarding.protocol.actions.fallbackReady",
      });
      setShareDialogOpen(true);
    });
  };

  const handleNativeShare = () => {
    const prepared = preparedPdfRef.current;
    const shareApi = navigator as Navigator & {
      share?: (data?: ShareData) => Promise<void>;
    };
    if (!prepared?.file || !shareApi.share || !nativeFileSharingAvailable(prepared.file)) {
      setNativeShareAvailable(false);
      setFeedback({ key: "employment.onboarding.protocol.actions.fallbackReady" });
      return;
    }

    try {
      void Promise.resolve(shareApi.share({
        files: [prepared.file],
        title: t("employment.onboarding.protocol.title"),
      })).then(() => {
        if (mountedRef.current) {
          setFeedback({ key: "employment.onboarding.protocol.actions.shareComplete" });
        }
      }).catch((error: unknown) => {
        if (!mountedRef.current || isShareCancellation(error)) return;
        setFeedback({ key: "employment.onboarding.protocol.actions.shareFailed", error: true });
      });
    } catch (error) {
      if (!isShareCancellation(error)) {
        setFeedback({ key: "employment.onboarding.protocol.actions.shareFailed", error: true });
      }
    }
  };

  const openEmailDialog = () => {
    setEmailRecipient("");
    setEmailFeedback(null);
    setEmailAccepted(false);
    setEmailDialogOpen(true);
  };

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSendingEmail || emailControllerRef.current) return;
    const input = event.currentTarget.elements.namedItem("recipientEmail") as HTMLInputElement | null;
    if (!input?.checkValidity()) {
      setEmailFeedback({ key: "employment.onboarding.protocol.actions.emailInvalidRecipient", error: true });
      input?.focus();
      return;
    }

    const endpoint = new URL(protectedUrl, window.location.origin);
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/email`;
    endpoint.search = "";
    const controller = new AbortController();
    emailControllerRef.current = controller;
    let timedOut = false;
    setIsSendingEmail(true);
    setEmailFeedback(null);
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, EMAIL_SEND_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint.toString(), {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail: emailRecipient.trim() }),
        signal: controller.signal,
      });
      if (response.status === 202) {
        const result = await response.json().catch(() => null) as { accepted?: unknown } | null;
        if (result?.accepted === true) {
          setEmailAccepted(true);
          setEmailFeedback({ key: "employment.onboarding.protocol.actions.emailAccepted" });
          return;
        }
      }
      const key = response.status === 401
        ? "sessionExpired"
        : response.status === 403
          ? "emailForbidden"
          : response.status === 400
            ? "emailInvalidRecipient"
            : response.status === 413
              ? "emailAttachmentTooLarge"
              : response.status === 503
                ? "emailNotConfigured"
                : "emailFailed";
      setEmailFeedback({
        key: `employment.onboarding.protocol.actions.${key}`,
        error: true,
      });
    } catch {
      if (!mountedRef.current) return;
      setEmailFeedback({
        key: `employment.onboarding.protocol.actions.${timedOut ? "emailTimeout" : "emailFailed"}`,
        error: true,
      });
    } finally {
      window.clearTimeout(timeout);
      if (emailControllerRef.current === controller) emailControllerRef.current = null;
      if (mountedRef.current) setIsSendingEmail(false);
    }
  };

  const handlePrint = () => {
    setPrintPreviewOpen(true);
    setPreviewState("loading");
    const prepared = preparedPdfRef.current;
    if (!prepared) {
      void preparePdf().then((result) => {
        if (!result && mountedRef.current) setPreviewState("failed");
      });
      return;
    }
    setFeedback({ key: "employment.onboarding.protocol.actions.previewLoading" });
    setPreviewVersion((version) => version + 1);
  };

  const handlePrintPreparedPdf = () => {
    if (previewState !== "ready" || !preparedPrintRef.current) {
      setFeedback({ key: "employment.onboarding.protocol.actions.printNotReady", error: true });
      return;
    }
    try {
      // Keep print() synchronous with this trusted click; preparation already finished.
      preparedPrintRef.current.print();
    } catch {
      setPreviewState("failed");
      setFeedback({ key: "employment.onboarding.protocol.actions.printFallback", error: true });
    }
  };

  const handleCopyLink = async () => {
    const link = new URL(protectedUrl, window.location.origin).toString();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const field = document.createElement("textarea");
        field.value = link;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        const copied = typeof document.execCommand === "function" && document.execCommand("copy");
        field.remove();
        if (!copied) throw new Error("Clipboard unavailable");
      }
      setCopyFailed(false);
      setFeedback({ key: "employment.onboarding.protocol.actions.linkCopied" });
    } catch {
      setCopyFailed(true);
      setFeedback({ key: "employment.onboarding.protocol.actions.copyFailed", error: true });
    }
  };

  const handleDownloadAttachment = () => {
    const prepared = preparedPdfRef.current;
    if (!prepared) return;
    const link = document.createElement("a");
    link.href = prepared.url;
    link.download = PDF_FILENAME;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const protectedLink = new URL(protectedUrl, window.location.origin).toString();
  const protectedDownloadUrl = new URL(protectedLink);
  protectedDownloadUrl.searchParams.set("download", "1");

  return (
    <div className="mt-4 space-y-3" aria-busy={isPreparing}>
      <div className={`grid grid-cols-1 gap-2 ${canEmailProtocol ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <button
          type="button"
          data-testid="share-onboarding-protocol"
          onClick={handleOpenShareDialog}
          disabled={isPreparing}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60"
        >
          {isPreparing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Share2 className="h-4 w-4" aria-hidden="true" />}
          {t(isPreparing ? "employment.onboarding.protocol.actions.preparing" : "employment.onboarding.protocol.actions.share")}
        </button>
        <button
          type="button"
          data-testid="print-onboarding-protocol"
          onClick={handlePrint}
          disabled={isPreparing}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
        >
          {isPreparing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Printer className="h-4 w-4" aria-hidden="true" />}
          {t(isPreparing ? "employment.onboarding.protocol.actions.preparing" : "employment.onboarding.protocol.actions.print")}
        </button>
        {canEmailProtocol && (
          <button
            type="button"
            data-testid="email-onboarding-protocol"
            onClick={openEmailDialog}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Mail className="h-4 w-4" aria-hidden="true" />
            {t("employment.onboarding.protocol.actions.emailPdf")}
          </button>
        )}
      </div>

      {feedback && !shareDialogOpen && !emailDialogOpen && (
        <p
          role={feedback.error ? "alert" : "status"}
          aria-live={feedback.error ? "assertive" : "polite"}
          data-testid="onboarding-protocol-feedback"
          className={`text-sm ${feedback.error ? "text-red-700" : "text-slate-600"}`}
        >
          {t(feedback.key)}
        </p>
      )}

      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent className="max-h-[85dvh] w-[calc(100%-1rem)] max-w-md overflow-y-auto p-5">
          <DialogHeader className="pr-6">
            <DialogTitle>{t("employment.onboarding.protocol.actions.shareDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("employment.onboarding.protocol.actions.shareDialogDescription")}
            </DialogDescription>
          </DialogHeader>
          {preparedUrl && (
            <div className="space-y-3">
              <p className="text-xs text-slate-600">
                {t("employment.onboarding.protocol.actions.signInRequired")}
              </p>
              {nativeShareAvailable ? (
                <button
                  type="button"
                  data-testid="native-share-onboarding-protocol"
                  onClick={handleNativeShare}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
                >
                  <Share2 className="h-4 w-4" aria-hidden="true" />
                  {t("employment.onboarding.protocol.actions.nativeShare")}
                </button>
              ) : (
                <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                  {t("employment.onboarding.protocol.actions.nativeShareUnavailable")}
                </p>
              )}
              <div
                aria-label={t("employment.onboarding.protocol.actions.fallbackOptions")}
                className="grid grid-cols-1 gap-2"
              >
                <button
                  type="button"
                  data-testid="copy-onboarding-protocol-link"
                  onClick={handleCopyLink}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Link2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {t("employment.onboarding.protocol.actions.copyLink")}
                </button>
                <button
                  type="button"
                  data-testid="download-onboarding-protocol-attachment"
                  onClick={handleDownloadAttachment}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {t("employment.onboarding.protocol.actions.downloadAttachment")}
                </button>
              </div>
              {copyFailed && (
                <label className="block text-xs text-slate-600">
                  {t("employment.onboarding.protocol.actions.linkFieldLabel")}
                  <input
                    readOnly
                    value={protectedLink}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
                  />
                </label>
              )}
            </div>
          )}
          {feedback && shareDialogOpen && (
            <p
              role={feedback.error ? "alert" : "status"}
              aria-live={feedback.error ? "assertive" : "polite"}
              data-testid="onboarding-protocol-dialog-feedback"
              className={`text-sm ${feedback.error ? "text-red-700" : "text-slate-600"}`}
            >
              {t(feedback.key)}
            </p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={emailDialogOpen}
        onOpenChange={(open) => {
          if (!open && isSendingEmail) return;
          setEmailDialogOpen(open);
        }}
      >
        <DialogContent className="max-h-[85dvh] w-[calc(100%-1rem)] max-w-md overflow-y-auto p-5">
          <DialogHeader className="pr-6">
            <DialogTitle>{t("employment.onboarding.protocol.actions.emailDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("employment.onboarding.protocol.actions.emailDialogDescription")}
            </DialogDescription>
          </DialogHeader>
          {emailAccepted ? (
            <div className="space-y-3">
              <p role="status" aria-live="polite" data-testid="onboarding-protocol-email-feedback" className="text-sm text-emerald-800">
                {t(emailFeedback?.key ?? "employment.onboarding.protocol.actions.emailAccepted")}
              </p>
              <button
                type="button"
                data-testid="send-another-onboarding-protocol-email"
                onClick={() => {
                  setEmailAccepted(false);
                  setEmailFeedback(null);
                }}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {t("employment.onboarding.protocol.actions.sendAnother")}
              </button>
            </div>
          ) : (
            <form onSubmit={handleEmailSubmit} className="space-y-4" aria-busy={isSendingEmail}>
              <label className="block text-sm font-medium text-slate-700" htmlFor="onboarding-protocol-recipient">
                {t("employment.onboarding.protocol.actions.recipientEmailLabel")}
                <input
                  id="onboarding-protocol-recipient"
                  name="recipientEmail"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  value={emailRecipient}
                  onChange={(event) => setEmailRecipient(event.target.value)}
                  disabled={isSendingEmail}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 disabled:bg-slate-50"
                  data-testid="onboarding-protocol-recipient"
                />
              </label>
              {emailFeedback && (
                <p
                  role={emailFeedback.error ? "alert" : "status"}
                  aria-live={emailFeedback.error ? "assertive" : "polite"}
                  data-testid="onboarding-protocol-email-feedback"
                  className={`text-sm ${emailFeedback.error ? "text-red-700" : "text-emerald-800"}`}
                >
                  {t(emailFeedback.key)}
                </p>
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setEmailDialogOpen(false)}
                  disabled={isSendingEmail}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  data-testid="send-onboarding-protocol-email"
                  disabled={isSendingEmail || !emailRecipient.trim()}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60"
                >
                  {isSendingEmail && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {t(isSendingEmail
                    ? "employment.onboarding.protocol.actions.emailSending"
                    : "employment.onboarding.protocol.actions.sendEmail")}
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {printPreviewOpen && (
        <section
          className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4"
          aria-busy={previewState === "loading"}
          aria-label={t("employment.onboarding.protocol.actions.previewTitle")}
        >
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-800">
              {t("employment.onboarding.protocol.actions.previewTitle")}
            </h4>
            <button
              type="button"
              onClick={() => setPrintPreviewOpen(false)}
              className="min-h-10 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-white"
            >
              {t("employment.onboarding.protocol.actions.closePreview")}
            </button>
          </div>
          {preparedUrl ? (
            <iframe
              key={previewVersion}
              ref={iframeRef}
              title={t("employment.onboarding.protocol.actions.previewTitle")}
              data-testid="onboarding-protocol-pdf-preview"
              className="h-[60vh] min-h-[360px] w-full rounded-lg border border-slate-200 bg-white sm:min-h-[520px]"
            />
          ) : (
            <p className="flex min-h-24 items-center justify-center gap-2 text-sm text-slate-500">
              {isPreparing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {t(isPreparing
                ? "employment.onboarding.protocol.actions.preparing"
                : "employment.onboarding.protocol.actions.previewUnavailable")}
            </p>
          )}
          {previewState === "loading" && preparedUrl && (
            <p role="status" aria-live="polite" className="text-sm text-slate-600">
              {t("employment.onboarding.protocol.actions.previewLoading")}
            </p>
          )}
          {previewState === "ready" && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p role="status" aria-live="polite" className="text-sm text-slate-600">
                {t("employment.onboarding.protocol.actions.previewReady", { count: previewPageCount })}
              </p>
              <button
                type="button"
                data-testid="print-prepared-onboarding-protocol"
                onClick={handlePrintPreparedPdf}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
              >
                <Printer className="h-4 w-4" aria-hidden="true" />
                {t("employment.onboarding.protocol.actions.printPreparedPdf")}
              </button>
            </div>
          )}
          {previewState === "failed" && (
            <div
              className="space-y-2"
              role="group"
              aria-label={t("employment.onboarding.protocol.actions.printFallback")}
              data-testid="onboarding-protocol-print-fallback"
            >
              <p className="text-sm text-amber-800">
                {t("employment.onboarding.protocol.actions.printFallback")}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <a
                  href={protectedLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="onboarding-protocol-open-pdf"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  {t("employment.onboarding.protocol.actions.openPdf")}
                </a>
                <a
                  href={protectedDownloadUrl.toString()}
                  data-testid="onboarding-protocol-download-fallback"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  {t("employment.onboarding.protocol.actions.downloadProtectedPdf")}
                </a>
              </div>
              <p className="text-xs text-slate-500">
                {t("employment.onboarding.protocol.actions.popupGuidance")}
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
