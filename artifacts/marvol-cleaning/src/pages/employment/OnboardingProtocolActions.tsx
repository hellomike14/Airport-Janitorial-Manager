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

const PDF_FILENAME = "Marvol_Employee_Onboarding_Protocol_v1.pdf";
const PDF_FETCH_TIMEOUT_MS = 30_000;
const PREVIEW_TIMEOUT_MS = 20_000;

type PreparedPdf = { file: File | null; url: string };
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

export function OnboardingProtocolActions({ protectedUrl }: { protectedUrl: string }) {
  const { t } = useTranslation();
  const [preparedUrl, setPreparedUrl] = useState<string | null>(null);
  const [nativeShareAvailable, setNativeShareAvailable] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [previewVersion, setPreviewVersion] = useState(0);

  const preparedPdfRef = useRef<PreparedPdf | null>(null);
  const pendingPreparationRef = useRef<Promise<PreparedPdf | null> | null>(null);
  const preparationControllerRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      preparationControllerRef.current?.abort();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!printPreviewOpen || !preparedUrl || previewState !== "loading") return;
    const timer = window.setTimeout(() => {
      setPreviewState("failed");
      setFeedback({ key: "employment.onboarding.protocol.actions.previewFailed", error: true });
    }, PREVIEW_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [printPreviewOpen, preparedUrl, previewState]);

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

        const prepared = { file, url };
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

    setFeedback({ key: "employment.onboarding.protocol.actions.shareReady" });
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

  const handlePrint = () => {
    setPrintPreviewOpen(true);
    const prepared = preparedPdfRef.current;
    if (!prepared) {
      setPreviewState("loading");
      void preparePdf().then((result) => {
        if (!result && mountedRef.current) setPreviewState("failed");
      });
      return;
    }
    setPreviewState("loading");
    setFeedback({ key: "employment.onboarding.protocol.actions.previewLoading" });
    setPreviewVersion((version) => version + 1);
  };

  const handlePrintPreparedPdf = () => {
    if (previewState !== "ready" || !iframeRef.current) {
      setFeedback({ key: "employment.onboarding.protocol.actions.printNotReady", error: true });
      return;
    }
    const frameWindow = iframeRef.current.contentWindow;
    try {
      if (!frameWindow || typeof frameWindow.print !== "function") throw new Error("PDF printing is unsupported");
      frameWindow.focus();
      frameWindow.print();
      setFeedback({ key: "employment.onboarding.protocol.actions.printDialogOpened" });
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
  const emailBody = [
    t("employment.onboarding.protocol.actions.emailIntro"),
    protectedLink,
    "",
    t("employment.onboarding.protocol.actions.signInRequired"),
  ].join("\n");
  const emailHref = `mailto:?subject=${encodeURIComponent(t("employment.onboarding.protocol.actions.emailSubject"))}&body=${encodeURIComponent(emailBody)}`;

  return (
    <div className="mt-4 space-y-3" aria-busy={isPreparing}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
      </div>

      {feedback && !shareDialogOpen && (
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
                <a
                  href={emailHref}
                  data-testid="email-onboarding-protocol-link"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {t("employment.onboarding.protocol.actions.emailLink")}
                </a>
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

      {printPreviewOpen && (
        <section className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
          <h4 className="text-sm font-semibold text-slate-800">
            {t("employment.onboarding.protocol.actions.previewTitle")}
          </h4>
          {preparedUrl ? (
            <iframe
              key={previewVersion}
              ref={iframeRef}
              src={preparedUrl}
              title={t("employment.onboarding.protocol.actions.previewTitle")}
              data-testid="onboarding-protocol-pdf-preview"
              onLoad={() => {
                setPreviewState("ready");
                setFeedback({ key: "employment.onboarding.protocol.actions.previewReady" });
              }}
              onError={() => {
                setPreviewState("failed");
                setFeedback({ key: "employment.onboarding.protocol.actions.previewFailed", error: true });
              }}
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
            <p role="status" className="text-sm text-slate-600">
              {t("employment.onboarding.protocol.actions.previewLoading")}
            </p>
          )}
          {previewState === "ready" && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">
                {t("employment.onboarding.protocol.actions.previewReady")}
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
              <a
                href={protectedUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="onboarding-protocol-open-pdf"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                {t("employment.onboarding.protocol.actions.openPdf")}
              </a>
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
