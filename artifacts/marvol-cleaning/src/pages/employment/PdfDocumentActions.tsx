import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Mail, Printer, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PdfPrintPreview } from "./PdfPrintPreview";

type Props = {
  title: string;
  pdfUrl: string;
  emailEndpoint?: string;
  testId: string;
};

function sameOriginUrl(path: string): string {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin) throw new Error("External document URL rejected");
  return url.toString();
}

function errorKeyForStatus(status: number): string {
  if (status === 400) return "employment.forms.documentActions.emailInvalidRecipient";
  if (status === 401) return "employment.forms.documentActions.sessionExpired";
  if (status === 403) return "employment.forms.documentActions.emailForbidden";
  if (status === 413) return "employment.forms.documentActions.emailTooLarge";
  if (status === 429) return "employment.forms.documentActions.emailRateLimited";
  if (status === 502) return "employment.forms.documentActions.emailProviderRejected";
  if (status === 503) return "employment.forms.documentActions.emailUnavailable";
  return "employment.forms.documentActions.emailFailed";
}

export function PdfDocumentActions({ title, pdfUrl, emailEndpoint, testId }: Props) {
  const { t } = useTranslation();
  const [printOpen, setPrintOpen] = useState(false);
  const [printBytes, setPrintBytes] = useState<Uint8Array | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ key: string; accepted?: boolean } | null>(null);
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => () => requestController.current?.abort(), []);

  const openPrintPreview = async () => {
    setLoadingPdf(true);
    setFeedback(null);
    const controller = new AbortController();
    requestController.current?.abort();
    requestController.current = controller;
    try {
      const response = await fetch(sameOriginUrl(pdfUrl), {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/pdf" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`PDF_FETCH_${response.status}`);
      if (response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/pdf") {
        throw new Error("PDF_FETCH_INVALID_CONTENT_TYPE");
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
        throw new Error("PDF_FETCH_INVALID_CONTENT");
      }
      setPrintBytes(bytes);
      setPrintOpen(true);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "";
      const status = Number(message.replace(/^PDF_FETCH_/, ""));
      setFeedback({
        key: Number.isInteger(status) && status > 0
          ? status === 401
            ? "employment.forms.documentActions.sessionExpired"
            : status === 403
              ? "employment.forms.documentActions.emailForbidden"
              : "employment.forms.documentActions.previewFailed"
          : "employment.forms.documentActions.previewFailed",
      });
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setLoadingPdf(false);
      }
    }
  };

  const sendEmail = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!emailEndpoint || emailBusy) return;
    setEmailBusy(true);
    setFeedback(null);
    setEmailFeedback(null);
    const controller = new AbortController();
    requestController.current?.abort();
    requestController.current = controller;
    try {
      const response = await fetch(sameOriginUrl(emailEndpoint), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ recipientEmail: recipient.trim() }),
        signal: controller.signal,
      });
      if (response.status !== 202) {
        setEmailFeedback(errorKeyForStatus(response.status));
        return;
      }
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !("accepted" in result) || result.accepted !== true) {
        setEmailFeedback("employment.forms.documentActions.emailFailed");
        return;
      }
      setRecipient("");
      setFeedback({ key: "employment.forms.documentActions.emailAccepted", accepted: true });
      setEmailOpen(false);
    } catch {
      if (!controller.signal.aborted) {
        setEmailFeedback("employment.forms.documentActions.emailFailed");
      }
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setEmailBusy(false);
      }
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-3">
        {emailEndpoint && (
          <button type="button" onClick={() => { setFeedback(null); setEmailFeedback(null); setEmailOpen(true); }}
            data-testid={`${testId}-email`}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Mail className="h-4 w-4" aria-hidden="true" />
            {t("employment.forms.documentActions.emailPdf")}
          </button>
        )}
        <button type="button" onClick={openPrintPreview} disabled={loadingPdf}
          data-testid={`${testId}-print-open`}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50">
          {loadingPdf
            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            : <Printer className="h-4 w-4" aria-hidden="true" />}
          {t("employment.forms.documentActions.print")}
        </button>
      </div>
      {feedback && (
        <p role={feedback.accepted ? "status" : "alert"}
          data-testid={`${testId}-feedback`}
          className={`mt-2 rounded-lg px-3 py-2 text-sm ${feedback.accepted ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
          {t(feedback.key)}
        </p>
      )}
      <Dialog open={emailOpen} onOpenChange={(open) => {
        if (!emailBusy) setEmailOpen(open);
      }}>
        <DialogContent className="w-[calc(100%-1rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>{t("employment.forms.documentActions.emailTitle")}</DialogTitle>
            <DialogDescription>
              {t("employment.forms.documentActions.emailDescription", { title })}
            </DialogDescription>
          </DialogHeader>
          {emailFeedback && (
            <p role="alert" data-testid={`${testId}-email-error`}
              className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t(emailFeedback)}
            </p>
          )}
          <form onSubmit={sendEmail} className="space-y-4">
            <div>
              <label htmlFor={`${testId}-recipient`} className="mb-1 block text-sm font-medium text-slate-700">
                {t("employment.forms.documentActions.recipientEmail")}
              </label>
              <input
                id={`${testId}-recipient`}
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                data-testid={`${testId}-recipient`}
                className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEmailOpen(false)} disabled={emailBusy}
                className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
                {t("employment.forms.documentActions.cancel")}
              </button>
              <button type="submit" disabled={emailBusy || !recipient.trim()}
                data-testid={`${testId}-email-submit`}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-50">
                {emailBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {t("employment.forms.documentActions.send")}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <PdfPrintPreview
        open={printOpen}
        title={title}
        bytes={printBytes}
        onOpenChange={(open) => {
          setPrintOpen(open);
          if (!open) setPrintBytes(null);
        }}
        testId={`${testId}-preview`}
      />
    </>
  );
}
