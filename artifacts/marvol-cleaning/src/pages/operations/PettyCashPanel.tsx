import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { History, Pencil, Printer, Plus, Save, X } from "lucide-react";
import {
  currentOrlandoDate,
  operationsApi,
  useOperations,
  type StaffOption,
} from "@/lib/operationsApi";
import { useAuth } from "@/contexts/AuthContext";
import { MarvolOperationsBrandHeader } from "@/components/operations/MarvolOperationsBrandHeader";

type CashExpense = {
  id: number;
  expenseDate: string;
  description: string;
  amountCents: number;
  receiptReceived: boolean;
  voucherNumber: string | null;
  receiptAttachment: {
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  } | null;
};
type CashRecord = {
  id: number;
  location: string;
  custodianId: number;
  custodianName: string;
  recordDate: string;
  openingFloatCents: number;
  openingFloatApprovedByName: string;
  openingFloatApprovedAt: string;
  cashOnHandCents: number;
  minimumReserveCents: number | null;
  targetFloatCents: number | null;
  reserveStatus: "replenishment_required" | "minimum_reached" | "above_minimum" | null;
  suggestedTopUpCents: number | null;
  expenses: CashExpense[];
  totalExpensesCents: number;
  expectedBalanceCents: number;
  overShortCents: number;
  status: "draft" | "completed";
  custodianAcknowledgedAt: string | null;
  custodianAcknowledgedRecordedByName: string | null;
  managerAcknowledgedByName: string | null;
  managerAcknowledgedAt: string | null;
  reimbursementStatus: "not_submitted" | "submitted" | "paid";
  reimbursementPaidConfirmed: boolean | null;
  reimbursementAmountCents: number | null;
  reimbursementReference: string | null;
  reimbursementSubmittedOn: string | null;
  reimbursementPaidOn: string | null;
  accountingNotes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};
type CashHistory = {
  id: number;
  event: string;
  version: number;
  actorName: string;
  snapshot: Record<string, unknown>;
  createdAt: string;
};
type CashMonthlyReport = {
  month: string;
  recordCount: number;
  expenseTotalCents: number;
  confirmedPaidReimbursementsCents: number;
  latestRecordDate: string | null;
  cashOnHandCents: number | null;
  minimumReserveCents: number | null;
  targetFloatCents: number | null;
  reserveStatus: CashRecord["reserveStatus"];
  suggestedTopUpCents: number | null;
};
type ExpenseDraft = {
  expenseDate: string;
  description: string;
  amount: string;
  receiptReceived: boolean;
  voucherNumber: string;
  receiptAttachmentId: string | null;
  receiptUploadId: string | null;
  receiptName: string | null;
  receiptPreviewUrl: string | null;
};
type FormDraft = {
  location: string;
  custodianId: string;
  recordDate: string;
  openingFloat: string;
  cashOnHand: string;
  custodianAcknowledged: boolean;
  managerAcknowledged: boolean;
  reimbursementStatus: CashRecord["reimbursementStatus"];
  paidPaymentConfirmed: boolean;
  reimbursementAmount: string;
  reimbursementReference: string;
  reimbursementSubmittedOn: string;
  reimbursementPaidOn: string;
  accountingNotes: string;
  expenses: ExpenseDraft[];
};

const field =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const button =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
const emptyExpense = (): ExpenseDraft => ({
  expenseDate: currentOrlandoDate(),
  description: "",
  amount: "",
  receiptReceived: false,
  voucherNumber: "",
  receiptAttachmentId: null,
  receiptUploadId: null,
  receiptName: null,
  receiptPreviewUrl: null,
});
const emptyForm = (): FormDraft => ({
  location: "",
  custodianId: "",
  recordDate: currentOrlandoDate(),
  openingFloat: "100.00",
  cashOnHand: "",
  custodianAcknowledged: false,
  managerAcknowledged: false,
  reimbursementStatus: "not_submitted",
  paidPaymentConfirmed: false,
  reimbursementAmount: "",
  reimbursementReference: "",
  reimbursementSubmittedOn: "",
  reimbursementPaidOn: "",
  accountingNotes: "",
  expenses: [emptyExpense()],
});
const centsFromInput = (value: string, label: string, optional = false) => {
  const text = value.trim();
  if (!text && optional) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new Error(`${label} must be a non-negative amount with at most two decimals.`);
  }
  const [dollars, cents = ""] = text.split(".");
  const result = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw new Error(`${label} is too large.`);
  return result;
};
const dollars = (cents: number | null) =>
  cents == null ? "" : (cents / 100).toFixed(2);
const localTimestamp = (value: string | null) =>
  value ? new Date(value).toLocaleString("en-US", { timeZone: "America/New_York" }) : "—";

function printCsv(recordId: number) {
  return fetch(`/api/operations/petty-cash/${recordId}/export.csv`, {
    credentials: "same-origin",
    cache: "no-store",
  });
}

async function downloadCsv(recordId: number) {
  const response = await printCsv(recordId);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "Unable to download the reconciliation.");
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `petty-cash-${recordId}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function uploadReceiptPhoto(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPEG, PNG or WebP receipt image.");
  }
  if (file.size < 1 || file.size > 8 * 1024 * 1024) {
    throw new Error("Receipt photos must be no larger than 8 MB.");
  }
  const reservation = await operationsApi<{
    uploadId: string;
    uploadUrl: string;
  }>("/petty-cash/receipts/uploads", "POST", {
    fileName: file.name,
    contentType: file.type,
    sizeBytes: file.size,
  });
  try {
    const uploaded = await fetch(reservation.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!uploaded.ok) throw new Error("The receipt photo did not finish uploading.");
    await operationsApi(
      `/petty-cash/receipts/uploads/${reservation.uploadId}/complete`,
      "POST",
      {},
    );
    return {
      id: reservation.uploadId,
      name: file.name,
      previewUrl: URL.createObjectURL(file),
    };
  } catch (error) {
    await operationsApi(`/petty-cash/receipts/uploads/${reservation.uploadId}`, "DELETE").catch(() => undefined);
    throw error;
  }
}

function receiptUrl(id: string, kind: "preview" | "download" = "preview") {
  return `/api/operations/petty-cash/receipts/${encodeURIComponent(id)}/${kind}`;
}

function RecordPrintView({ record }: { record: CashRecord }) {
  return (
    <section className="operations-print-document hidden">
      <MarvolOperationsBrandHeader
        title="Petty Cash Reconciliation"
        subtitle={`${record.recordDate} · ${record.location}`}
      />
      <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
        <p><strong>Custodian:</strong> {record.custodianName}</p>
        <p><strong>Status:</strong> Completed</p>
        <p><strong>Opening float:</strong> {money(record.openingFloatCents)}</p>
        <p><strong>Actual cash on hand:</strong> {money(record.cashOnHandCents)}</p>
        <p><strong>Minimum reserve:</strong> {record.minimumReserveCents == null ? "Not stored for this historical record" : money(record.minimumReserveCents)}</p>
        <p><strong>Reserve status:</strong> {record.reserveStatus?.replaceAll("_", " ") ?? "Not stored for this historical record"}</p>
        <p><strong>Suggested top-up:</strong> {record.suggestedTopUpCents == null ? "—" : money(record.suggestedTopUpCents)}</p>
        <p><strong>Total expenses:</strong> {money(record.totalExpensesCents)}</p>
        <p><strong>Expected balance:</strong> {money(record.expectedBalanceCents)}</p>
        <p><strong>Over / (short):</strong> {money(record.overShortCents)}</p>
        <p><strong>Opening float approved by:</strong> {record.openingFloatApprovedByName}</p>
      </div>
      <table className="mt-6 w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {["Date", "Voucher #", "Expense", "Amount", "Receipt", "Photo"].map((label) => (
              <th key={label} className="border-b border-slate-400 p-2">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {record.expenses.map((expense) => (
            <tr key={expense.id}>
              <td className="border-b border-slate-200 p-2">{expense.expenseDate}</td>
              <td className="border-b border-slate-200 p-2">{expense.voucherNumber || "—"}</td>
              <td className="border-b border-slate-200 p-2">{expense.description}</td>
              <td className="border-b border-slate-200 p-2">{money(expense.amountCents)}</td>
              <td className="border-b border-slate-200 p-2">{expense.receiptReceived ? "Received" : "Missing"}</td>
              <td className="border-b border-slate-200 p-2">
                {expense.receiptAttachment && (
                  <div className="space-y-1">
                    <img src={receiptUrl(expense.receiptAttachment.id)} alt={`Receipt for ${expense.description}`} className="max-h-28 max-w-40 object-contain" />
                    <a href={receiptUrl(expense.receiptAttachment.id, "download")}>{expense.receiptAttachment.fileName}</a>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
        <p><strong>Custodian acknowledgement recorded:</strong> {localTimestamp(record.custodianAcknowledgedAt)}</p>
        <p><strong>Recorded by:</strong> {record.custodianAcknowledgedRecordedByName ?? "—"}</p>
        <p><strong>Manager approval:</strong> {record.managerAcknowledgedByName ?? "—"}</p>
        <p><strong>Approved at:</strong> {localTimestamp(record.managerAcknowledgedAt)}</p>
      </div>
      <div className="mt-6 border-t border-slate-300 pt-4 text-sm">
        <h3 className="font-semibold">Accounting reimbursement</h3>
        <p>Status: {record.reimbursementStatus.replaceAll("_", " ")}</p>
        <p>Amount: {record.reimbursementAmountCents == null ? "—" : money(record.reimbursementAmountCents)}</p>
        <p>Reference: {record.reimbursementReference || "—"}</p>
        <p>Submitted: {record.reimbursementSubmittedOn || "—"} · Paid: {record.reimbursementPaidOn || "—"}</p>
        {record.accountingNotes && <p className="mt-2 whitespace-pre-wrap">{record.accountingNotes}</p>}
      </div>
    </section>
  );
}

export default function PettyCashPanel() {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const records = useOperations<CashRecord[]>("/petty-cash");
  const staff = useOperations<StaffOption[]>("/staff-options");
  const [reportMonth, setReportMonth] = useState(currentOrlandoDate().slice(0, 7));
  const monthlyReport = useOperations<CashMonthlyReport>(
    `/petty-cash/monthly-report?month=${encodeURIComponent(reportMonth)}`,
  );
  const [form, setForm] = useState<FormDraft>(emptyForm);
  const [editing, setEditing] = useState<CashRecord | null>(null);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const history = useOperations<CashHistory[]>(
    historyId == null ? "/petty-cash/0/history" : `/petty-cash/${historyId}/history`,
    historyId != null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [printRecord, setPrintRecord] = useState<CashRecord | null>(null);
  const [preview, setPreview] = useState<{ expected: number; overShort: number } | null>(null);
  const [receiptBusyIndex, setReceiptBusyIndex] = useState<number | null>(null);

  useEffect(() => {
    try {
      const opening = form.openingFloat.trim() ? centsFromInput(form.openingFloat, "Opening float") : null;
      const cash = form.cashOnHand.trim() ? centsFromInput(form.cashOnHand, "Cash on hand") : null;
      const expenses = form.expenses.reduce(
        (sum, expense) => sum + (expense.amount.trim() ? centsFromInput(expense.amount, "Expense") ?? 0 : 0),
        0,
      );
      setPreview(opening == null || cash == null ? null : {
        expected: opening - expenses,
        overShort: cash - (opening - expenses),
      });
    } catch {
      setPreview(null);
    }
  }, [form.openingFloat, form.cashOnHand, form.expenses]);

  useEffect(() => {
    if (!printRecord) return;
    const timer = window.setTimeout(() => window.print(), 100);
    const finish = () => setPrintRecord(null);
    window.addEventListener("afterprint", finish);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", finish);
    };
  }, [printRecord]);

  const resetForm = (discardUploads = true) => {
    for (const expense of form.expenses) {
      if (discardUploads && expense.receiptUploadId) {
        void operationsApi(
          `/petty-cash/receipts/uploads/${expense.receiptUploadId}`,
          "DELETE",
        ).catch(() => undefined);
      }
      if (expense.receiptPreviewUrl) URL.revokeObjectURL(expense.receiptPreviewUrl);
    }
    setForm(emptyForm());
    setEditing(null);
  };

  const startEdit = (record: CashRecord) => {
    setEditing(record);
    setForm({
      location: record.location,
      custodianId: String(record.custodianId),
      recordDate: record.recordDate,
      openingFloat: dollars(record.openingFloatCents),
      cashOnHand: dollars(record.cashOnHandCents),
      custodianAcknowledged: !!record.custodianAcknowledgedAt,
      managerAcknowledged: record.status === "completed",
      reimbursementStatus: record.reimbursementStatus,
      paidPaymentConfirmed: record.reimbursementPaidConfirmed === true,
      reimbursementAmount: dollars(record.reimbursementAmountCents),
      reimbursementReference: record.reimbursementReference ?? "",
      reimbursementSubmittedOn: record.reimbursementSubmittedOn ?? "",
      reimbursementPaidOn: record.reimbursementPaidOn ?? "",
      accountingNotes: record.accountingNotes ?? "",
      expenses: record.expenses.length
        ? record.expenses.map((expense) => ({
            expenseDate: expense.expenseDate,
            description: expense.description,
            amount: dollars(expense.amountCents),
            receiptReceived: expense.receiptReceived,
            voucherNumber: expense.voucherNumber ?? "",
            receiptAttachmentId: expense.receiptAttachment?.id ?? null,
            receiptUploadId: null,
            receiptName: expense.receiptAttachment?.fileName ?? null,
            receiptPreviewUrl: null,
          }))
        : [emptyExpense()],
    });
  };

  const handleReceiptPhoto = async (index: number, file?: File) => {
    if (!file) return;
    setReceiptBusyIndex(index);
    setError("");
    try {
      const uploaded = await uploadReceiptPhoto(file);
      const previous = form.expenses[index];
      if (previous?.receiptUploadId) {
        await operationsApi(
          `/petty-cash/receipts/uploads/${previous.receiptUploadId}`,
          "DELETE",
        ).catch(() => undefined);
      }
      if (previous?.receiptPreviewUrl) URL.revokeObjectURL(previous.receiptPreviewUrl);
      setForm((current) => ({
        ...current,
        expenses: current.expenses.map((item, i) => i === index
          ? {
              ...item,
              receiptAttachmentId: null,
              receiptUploadId: uploaded.id,
              receiptName: uploaded.name,
              receiptPreviewUrl: uploaded.previewUrl,
              receiptReceived: true,
            }
          : item),
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to upload the receipt photo.");
    } finally {
      setReceiptBusyIndex(null);
    }
  };

  const removeReceiptPhoto = async (index: number) => {
    const expense = form.expenses[index];
    if (!expense) return;
    if (expense.receiptUploadId) {
      try {
        await operationsApi(
          `/petty-cash/receipts/uploads/${expense.receiptUploadId}`,
          "DELETE",
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to remove the draft photo.");
        return;
      }
    }
    if (expense.receiptPreviewUrl) URL.revokeObjectURL(expense.receiptPreviewUrl);
    setForm((current) => ({
      ...current,
      expenses: current.expenses.map((item, i) => i === index
        ? {
            ...item,
            receiptAttachmentId: null,
            receiptUploadId: null,
            receiptName: null,
            receiptPreviewUrl: null,
          }
        : item),
    }));
  };

  const save = async (status: "draft" | "completed") => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!form.location.trim()) throw new Error("Enter a location.");
      if (!form.custodianId) throw new Error("Select a custodian.");
      const openingFloatCents = centsFromInput(form.openingFloat, "Opening float");
      const cashOnHandCents = centsFromInput(form.cashOnHand, "Cash on hand");
      if (openingFloatCents == null || cashOnHandCents == null) {
        throw new Error("Enter the manager-approved opening float and actual cash on hand.");
      }
      const expenses = form.expenses.flatMap((expense) => {
        const anyValue =
          expense.description.trim() ||
          expense.amount.trim() ||
          expense.receiptReceived;
        if (!anyValue) return [];
        if (!expense.description.trim() || !expense.expenseDate || !expense.amount.trim()) {
          throw new Error("Complete the date, description and amount for each expense.");
        }
        const amountCents = centsFromInput(expense.amount, "Expense");
        if (amountCents == null || amountCents < 1) {
          throw new Error("Each expense must be greater than zero.");
        }
        return [{
          expenseDate: expense.expenseDate,
          description: expense.description.trim(),
          amountCents,
          receiptReceived: expense.receiptReceived,
          voucherNumber: expense.voucherNumber.trim() || null,
          receiptAttachmentId: expense.receiptAttachmentId,
          receiptUploadId: expense.receiptUploadId,
        }];
      });
      const reimbursementAmountCents = centsFromInput(
        form.reimbursementAmount,
        "Reimbursement amount",
        true,
      );
      const body = {
        location: form.location.trim(),
        custodianId: Number(form.custodianId),
        recordDate: form.recordDate,
        openingFloatCents,
        cashOnHandCents,
        status,
        custodianAcknowledged: form.custodianAcknowledged,
        managerAcknowledged: status === "completed" && form.managerAcknowledged,
        reimbursementStatus: form.reimbursementStatus,
        reimbursementPaidConfirmed: form.paidPaymentConfirmed,
        reimbursementAmountCents,
        reimbursementReference: form.reimbursementReference.trim() || null,
        reimbursementSubmittedOn: form.reimbursementSubmittedOn || null,
        reimbursementPaidOn: form.reimbursementPaidOn || null,
        accountingNotes: form.accountingNotes.trim() || null,
        expenses,
      };
      if (status === "completed" && !body.custodianAcknowledged) {
        throw new Error("Confirm that the custodian has acknowledged the reconciliation.");
      }
      if (status === "completed" && !body.managerAcknowledged) {
        throw new Error("Confirm manager approval before completing this reconciliation.");
      }
      if (form.reimbursementStatus === "paid" && !form.paidPaymentConfirmed) {
        throw new Error("Confirm that the reimbursement has already been paid. This only records payment; it does not send money.");
      }
      if (editing) {
        await operationsApi(`/petty-cash/${editing.id}`, "PATCH", {
          ...body,
          expectedVersion: editing.version,
        });
      } else {
        await operationsApi("/petty-cash", "POST", body);
      }
      await queryClient.invalidateQueries({ queryKey: ["operations", currentUser?.id] });
      setNotice(status === "completed" ? "Reconciliation completed and acknowledged." : "Draft saved.");
      resetForm(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save the reconciliation.");
    } finally {
      setBusy(false);
    }
  };

  let previewActualCashCents: number | null = null;
  try {
    if (form.cashOnHand.trim()) {
      previewActualCashCents = centsFromInput(form.cashOnHand, "Cash on hand");
    }
  } catch {
    previewActualCashCents = null;
  }
  const reserveMessage = previewActualCashCents == null
    ? "Enter the counted cash to calculate reserve status."
    : previewActualCashCents < 3_000
      ? "Replenishment required"
      : previewActualCashCents === 3_000
        ? "Minimum reached — replenish soon"
        : "Above minimum reserve";
  const suggestedTopUpCents = previewActualCashCents == null
    ? null
    : Math.max(0, 10_000 - previewActualCashCents);

  return (
    <div className="space-y-5">
      <style>{`
        @media print {
          @page { margin: 0.5in; }
          body * { visibility: hidden !important; }
          .operations-print-document,
          .operations-print-document * { visibility: visible !important; }
          .operations-print-document {
            display: block !important;
            position: fixed;
            inset: 0;
            width: 100%;
            padding: 24px;
            background: white;
            color: #0f172a;
          }
        }
      `}</style>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 space-y-5">
        <MarvolOperationsBrandHeader
          title="Petty Cash"
          subtitle="Reconcile cash, track receipts and record reimbursement progress."
        />
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          New reconciliations start with a $100.00 opening float. Verify and approve the float yourself; no workbook balance is imported.
        </div>
        <div className="space-y-3 rounded-lg border border-slate-200 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">Monthly reconciliation report</h3>
              <p className="text-xs text-slate-500">Grouped by reconciliation record date.</p>
            </div>
            <label className="space-y-1 text-sm">
              <span>Report month</span>
              <input type="month" className={field} value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} />
            </label>
          </div>
          {monthlyReport.isLoading ? <p className="text-sm text-slate-500">Loading monthly report…</p> :
            monthlyReport.error ? <p role="alert" className="text-sm text-rose-700">Unable to load the monthly report.</p> :
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <p className="text-sm"><span className="block text-slate-600">Reconciliations</span><strong>{monthlyReport.data?.recordCount ?? 0}</strong></p>
                <p className="text-sm"><span className="block text-slate-600">Recorded expenses</span><strong>{money(monthlyReport.data?.expenseTotalCents ?? 0)}</strong></p>
                <p className="text-sm"><span className="block text-slate-600">Confirmed paid reimbursements</span><strong>{money(monthlyReport.data?.confirmedPaidReimbursementsCents ?? 0)}</strong></p>
                <p className="text-sm"><span className="block text-slate-600">Latest record date</span><strong>{monthlyReport.data?.latestRecordDate ?? "—"}</strong></p>
                <p className="text-sm"><span className="block text-slate-600">Latest actual cash on hand</span><strong>{monthlyReport.data?.cashOnHandCents == null ? "—" : money(monthlyReport.data.cashOnHandCents)}</strong></p>
                <p className="text-sm"><span className="block text-slate-600">Latest reserve status</span><strong>{monthlyReport.data?.reserveStatus?.replaceAll("_", " ") ?? "No reserve policy stored for this historical period"}</strong></p>
                <p className="text-sm"><span className="block text-slate-600">Latest suggested top-up to $100</span><strong>{monthlyReport.data?.suggestedTopUpCents == null ? "—" : money(monthlyReport.data.suggestedTopUpCents)}</strong></p>
              </div>}
        </div>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save("draft");
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span>Location</span>
              <input className={field} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} required />
            </label>
            <label className="space-y-1 text-sm">
              <span>Cash custodian</span>
              <select className={field} value={form.custodianId} onChange={(e) => setForm({ ...form, custodianId: e.target.value })} required>
                <option value="">Select custodian</option>
                {(staff.data ?? []).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>Record date</span>
              <input type="date" className={field} value={form.recordDate} onChange={(e) => setForm({ ...form, recordDate: e.target.value })} required />
            </label>
            <label className="space-y-1 text-sm">
              <span>Manager-approved opening float (USD; new records default to $100.00)</span>
              <input type="number" min="0" step="0.01" className={field} value={form.openingFloat} onChange={(e) => setForm({ ...form, openingFloat: e.target.value })} required />
            </label>
            <label className="space-y-1 text-sm">
              <span>Actual cash on hand (USD)</span>
              <input type="number" min="0" step="0.01" className={field} value={form.cashOnHand} onChange={(e) => setForm({ ...form, cashOnHand: e.target.value })} required />
            </label>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-slate-900">Itemized expenses</h3>
              <button
                type="button"
                disabled={busy || receiptBusyIndex != null}
                onClick={() => setForm({ ...form, expenses: [...form.expenses, emptyExpense()] })}
                className={`${button} border border-slate-300 text-slate-700 hover:bg-slate-50`}
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> Add expense
              </button>
            </div>
            {form.expenses.map((expense, index) => (
              <div key={index} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[140px_1fr_130px_auto_auto] sm:items-end">
                <label className="space-y-1 text-sm">
                  <span>Expense date</span>
                  <input type="date" className={field} value={expense.expenseDate} onChange={(e) => setForm({
                    ...form,
                    expenses: form.expenses.map((item, i) => i === index ? { ...item, expenseDate: e.target.value } : item),
                  })} />
                </label>
                <label className="space-y-1 text-sm">
                  <span>Description</span>
                  <input className={field} value={expense.description} onChange={(e) => setForm({
                    ...form,
                    expenses: form.expenses.map((item, i) => i === index ? { ...item, description: e.target.value } : item),
                  })} />
                </label>
                <label className="space-y-1 text-sm">
                  <span>Amount (USD)</span>
                  <input type="number" min="0.01" step="0.01" className={field} value={expense.amount} onChange={(e) => setForm({
                    ...form,
                    expenses: form.expenses.map((item, i) => i === index ? { ...item, amount: e.target.value } : item),
                  })} />
                </label>
                <label className="space-y-1 text-sm sm:col-span-2">
                  <span>Voucher number</span>
                  <input className={field} maxLength={100} value={expense.voucherNumber} onChange={(e) => setForm({
                    ...form,
                    expenses: form.expenses.map((item, i) => i === index ? { ...item, voucherNumber: e.target.value } : item),
                  })} />
                </label>
                <label className="flex min-h-10 items-center gap-2 text-sm">
                  <input type="checkbox" checked={expense.receiptReceived} onChange={(e) => setForm({
                    ...form,
                    expenses: form.expenses.map((item, i) => i === index ? { ...item, receiptReceived: e.target.checked } : item),
                  })} />
                  Receipt received
                </label>
                <div className="space-y-2 text-sm sm:col-span-2">
                  <label className="block space-y-1">
                    <span>Receipt photo (JPEG, PNG or WebP; up to 8 MB)</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className={`${field} file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1`}
                      disabled={receiptBusyIndex != null || busy}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.currentTarget.value = "";
                        void handleReceiptPhoto(index, file);
                      }}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span>Take receipt photo</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      capture="environment"
                      aria-label={`Take receipt photo for expense ${index + 1}`}
                      className={`${field} file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1`}
                      disabled={receiptBusyIndex != null || busy}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.currentTarget.value = "";
                        void handleReceiptPhoto(index, file);
                      }}
                    />
                    <span className="block text-xs text-slate-500">Use your phone camera, or choose an existing image with Receipt photo above.</span>
                  </label>
                  {(expense.receiptPreviewUrl || expense.receiptAttachmentId) && (
                    <div className="flex items-start gap-3">
                      <img
                        src={expense.receiptPreviewUrl ?? receiptUrl(expense.receiptAttachmentId!)}
                        alt={`Receipt for ${expense.description || `expense ${index + 1}`}`}
                        className="max-h-28 max-w-40 rounded border border-slate-200 object-contain"
                      />
                      <div className="min-w-0">
                        <p className="break-all text-xs text-slate-600">{expense.receiptName ?? "Saved receipt photo"}</p>
                        {expense.receiptAttachmentId && (
                          <a href={receiptUrl(expense.receiptAttachmentId, "download")} className="text-xs font-semibold text-emerald-800 underline">Download photo</a>
                        )}
                        <button type="button" disabled={busy || receiptBusyIndex != null} onClick={() => void removeReceiptPhoto(index)} className="ml-3 text-xs font-semibold text-rose-700 underline">Remove photo</button>
                      </div>
                    </div>
                  )}
                </div>
                {form.expenses.length > 1 && (
                  <button
                    type="button"
                    disabled={busy || receiptBusyIndex != null}
                    aria-label={`Remove expense ${index + 1}`}
                    onClick={() => {
                      const removed = form.expenses[index];
                      if (removed?.receiptPreviewUrl) URL.revokeObjectURL(removed.receiptPreviewUrl);
                      if (removed?.receiptUploadId) {
                        void operationsApi(`/petty-cash/receipts/uploads/${removed.receiptUploadId}`, "DELETE").catch(() => undefined);
                      }
                      setForm({ ...form, expenses: form.expenses.filter((_, i) => i !== index) });
                    }}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="grid gap-3 rounded-lg border border-emerald-100 bg-emerald-50/60 p-4 sm:grid-cols-3">
            <p className="text-sm"><span className="block text-slate-600">Expected balance</span><strong>{preview ? money(preview.expected) : "Enter float and cash"}</strong></p>
            <p className="text-sm"><span className="block text-slate-600">Actual cash</span><strong>{form.cashOnHand && Number.isFinite(Number(form.cashOnHand)) ? `$${Number(form.cashOnHand).toFixed(2)}` : "—"}</strong></p>
            <p className="text-sm"><span className="block text-slate-600">Over / (short)</span><strong>{preview ? money(preview.overShort) : "—"}</strong></p>
            <p className="text-sm"><span className="block text-slate-600">Minimum reserve</span><strong>$30.00</strong></p>
            <p className="text-sm"><span className="block text-slate-600">Reserve status</span><strong>{reserveMessage}</strong></p>
            <p className="text-sm"><span className="block text-slate-600">Suggested top-up to $100.00</span><strong>{suggestedTopUpCents == null ? "—" : money(suggestedTopUpCents)}</strong></p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
              <input type="checkbox" checked={form.custodianAcknowledged} onChange={(e) => setForm({ ...form, custodianAcknowledged: e.target.checked })} className="mt-0.5" />
              <span>Custodian has acknowledged this cash count and the listed expenses.</span>
            </label>
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
              <input type="checkbox" checked={form.managerAcknowledged} onChange={(e) => setForm({ ...form, managerAcknowledged: e.target.checked })} className="mt-0.5" />
              <span>I approve this reconciliation as the managing administrator or supervisor.</span>
            </label>
          </div>
          <div className="space-y-3 rounded-lg border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-900">Accounting reimbursement</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="space-y-1 text-sm">
                <span>Status</span>
                <select className={field} value={form.reimbursementStatus} disabled={editing?.reimbursementStatus === "paid"} onChange={(e) => setForm({ ...form, reimbursementStatus: e.target.value as FormDraft["reimbursementStatus"] })}>
                  <option value="not_submitted">Not submitted</option>
                  <option value="submitted">Submitted</option>
                  <option value="paid">Paid</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>Reimbursement amount (USD)</span>
                <input type="number" min="0.01" step="0.01" className={field} value={form.reimbursementAmount} disabled={editing?.reimbursementStatus === "paid"} onChange={(e) => setForm({ ...form, reimbursementAmount: e.target.value })} />
              </label>
              <label className="space-y-1 text-sm">
                <span>Reference</span>
                <input className={field} maxLength={200} value={form.reimbursementReference} disabled={editing?.reimbursementStatus === "paid"} onChange={(e) => setForm({ ...form, reimbursementReference: e.target.value })} />
              </label>
              <label className="space-y-1 text-sm">
                <span>Submitted on</span>
                <input type="date" className={field} value={form.reimbursementSubmittedOn} onChange={(e) => setForm({ ...form, reimbursementSubmittedOn: e.target.value })} />
              </label>
              <label className="space-y-1 text-sm">
                <span>Paid on</span>
                <input type="date" className={field} value={form.reimbursementPaidOn} disabled={editing?.reimbursementStatus === "paid"} onChange={(e) => setForm({ ...form, reimbursementPaidOn: e.target.value })} />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2 lg:col-span-1">
                <span>Accounting notes</span>
                <input className={field} value={form.accountingNotes} onChange={(e) => setForm({ ...form, accountingNotes: e.target.value })} />
              </label>
            </div>
            {form.reimbursementStatus === "paid" && (
              <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <input
                  type="checkbox"
                  checked={form.paidPaymentConfirmed}
                  disabled={editing?.reimbursementPaidConfirmed === true}
                  onChange={(event) => setForm({ ...form, paidPaymentConfirmed: event.target.checked })}
                  className="mt-0.5"
                />
                <span>
                  I verified this reimbursement was already paid and entered its actual amount, date and reference. This records the payment only; it does not initiate or send money.
                </span>
              </label>
            )}
          </div>
          {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
          <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busy || receiptBusyIndex != null} className={`${button} bg-emerald-800 text-white hover:bg-emerald-900`}>
              <Save className="h-4 w-4" aria-hidden="true" /> {busy ? "Saving…" : "Save draft"}
            </button>
            <button type="button" disabled={busy || receiptBusyIndex != null} onClick={() => void save("completed")} className={`${button} bg-slate-900 text-white hover:bg-slate-800`}>
              {busy ? "Saving…" : "Complete reconciliation"}
            </button>
            {editing && <button type="button" disabled={busy || receiptBusyIndex != null} onClick={() => resetForm()} className={`${button} border border-slate-300 text-slate-700 hover:bg-slate-50`}>Cancel edit</button>}
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 space-y-4">
        <h3 className="text-lg font-semibold text-slate-900">Reconciliation history</h3>
        {records.isLoading ? <p className="text-sm text-slate-500">Loading records…</p> :
          records.error ? <p role="alert" className="text-sm text-rose-700">Unable to load Petty Cash records.</p> :
            !records.data?.length ? <p className="text-sm text-slate-500">No reconciliations recorded yet.</p> :
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead><tr className="border-b text-slate-500">
                    {["Date", "Location", "Custodian", "Status", "Expected", "Actual", "Over / (short)", "Reserve", "Top-up", "Actions"].map((label) => <th key={label} className="p-2">{label}</th>)}
                  </tr></thead>
                  <tbody>
                    {records.data.map((record) => (
                      <tr key={record.id} className="border-b border-slate-100">
                        <td className="p-2">{record.recordDate}</td>
                        <td className="p-2">{record.location}</td>
                        <td className="p-2">{record.custodianName}</td>
                        <td className="p-2"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${record.status === "completed" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{record.status}</span></td>
                        <td className="p-2">{money(record.expectedBalanceCents)}</td>
                        <td className="p-2">{money(record.cashOnHandCents)}</td>
                        <td className="p-2">{money(record.overShortCents)}</td>
                        <td className="p-2">{record.reserveStatus?.replaceAll("_", " ") ?? "—"}</td>
                        <td className="p-2">{record.suggestedTopUpCents == null ? "—" : money(record.suggestedTopUpCents)}</td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-1">
                            <button type="button" onClick={() => startEdit(record)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label={`Edit reconciliation ${record.id}`}><Pencil className="h-4 w-4" aria-hidden="true" /></button>
                            <button type="button" onClick={() => setHistoryId(historyId === record.id ? null : record.id)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label={`View history for reconciliation ${record.id}`}><History className="h-4 w-4" aria-hidden="true" /></button>
                            <button type="button" onClick={() => setPrintRecord(record)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label={`Print reconciliation ${record.id}`}><Printer className="h-4 w-4" aria-hidden="true" /></button>
                            {record.status === "completed" && <button type="button" onClick={() => void downloadCsv(record.id).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to export."))} className="rounded-md px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-50">CSV</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
        {historyId != null && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="font-semibold">Change history · record #{historyId}</h4>
              <button type="button" onClick={() => setHistoryId(null)} className="text-sm text-slate-600 underline">Close</button>
            </div>
            {history.isLoading ? <p className="text-sm">Loading…</p> : history.error ? <p role="alert" className="text-sm text-rose-700">Unable to load history.</p> :
              <ul className="space-y-2 text-sm">
                {(history.data ?? []).map((entry) => (
                  <li key={entry.id} className="border-t border-slate-200 pt-2">
                    <strong>{entry.event}</strong> · version {entry.version} · {entry.actorName} · {localTimestamp(entry.createdAt)}
                  </li>
                ))}
              </ul>}
          </div>
        )}
      </section>
      {printRecord && <RecordPrintView record={printRecord} />}
    </div>
  );
}
