import React from "react";
import type { ChatMessageReceipt } from "@workspace/api-client-react";

type ReceiptLabels = {
  unconfirmed: string;
  confirmed: (name: string, role: string, time: string) => string;
  scopeNote: string;
  confirm: string;
  pending: string;
  error: string;
  historyLabel: string;
  earlierVersion: (version: number, name: string, role: string, time: string) => string;
};

type Props = {
  receipt: ChatMessageReceipt;
  pending: boolean;
  error: boolean;
  onConfirm: () => void;
  formatTimestamp: (timestamp: string) => string;
  labels: ReceiptLabels;
  tone?: "mine" | "other";
};

export function MessageReceiptStatus({
  receipt,
  pending,
  error,
  onConfirm,
  formatTimestamp,
  labels,
  tone = "other",
}: Props) {
  if (!receipt.applicable) return null;

  const textTone = tone === "mine" ? "text-emerald-50" : "text-slate-700";
  const dividerTone = tone === "mine" ? "border-white/25" : "border-slate-200";

  return (
    <section
      className={`mt-2 border-t pt-2 text-[11px] ${dividerTone} ${textTone}`}
      data-testid="message-receipt-status"
    >
      <p role="status" aria-live="polite" data-testid="message-receipt-state">
        {receipt.status === "confirmed" && receipt.confirmedBy && receipt.confirmedAt
          ? labels.confirmed(
              receipt.confirmedBy.name,
              receipt.confirmedBy.role,
              formatTimestamp(receipt.confirmedAt),
            )
          : labels.unconfirmed}
      </p>
      {pending && (
        <p role="status" aria-live="polite" data-testid="message-receipt-pending">
          {labels.pending}
        </p>
      )}
      {receipt.status === "unconfirmed" && receipt.canConfirm && (
        <button
          type="button"
          className="mt-1 rounded-md border border-current px-2 py-1 font-semibold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60"
          onClick={onConfirm}
          disabled={pending}
          aria-busy={pending}
          data-testid="confirm-message-receipt"
        >
          {pending ? labels.pending : labels.confirm}
        </button>
      )}
      <p className="mt-1 opacity-90">{labels.scopeNote}</p>
      {error && (
        <p role="alert" className={`mt-1 font-semibold ${tone === "mine" ? "text-rose-100" : "text-rose-700"}`} data-testid="message-receipt-error">
          {labels.error}
        </p>
      )}
      {receipt.previousVersions.length > 0 && (
        <ul className="mt-1 space-y-0.5" aria-label={labels.historyLabel} data-testid="message-receipt-history">
          {receipt.previousVersions.map((previous) => (
            <li key={`${previous.version}-${previous.confirmedAt}`}>
              {labels.earlierVersion(
                previous.version,
                previous.confirmedBy.name,
                previous.confirmedBy.role,
                formatTimestamp(previous.confirmedAt),
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type { ReceiptLabels };
