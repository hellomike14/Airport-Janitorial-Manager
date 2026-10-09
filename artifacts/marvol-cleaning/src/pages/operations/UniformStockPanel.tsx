import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Download, Pencil, Printer, RotateCcw, Save, Shirt } from "lucide-react";
import {
  operationsApi,
  useOperations,
  type StaffOption,
} from "@/lib/operationsApi";
import { useAuth } from "@/contexts/AuthContext";
import { MarvolOperationsBrandHeader } from "@/components/operations/MarvolOperationsBrandHeader";
import { eligibleOperationsAssignees } from "@/lib/operationsEmployeeEligibility";

type UniformItem = {
  id: number;
  itemCode: string | null;
  itemName: string;
  description: string | null;
  size: string;
  currentQuantity: number;
  outstandingIssued: number;
  reorderLevel: number;
  lastOrderDate: string | null;
  active: boolean;
  lowStock: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};
type UniformTransaction = {
  id: number;
  itemId: number;
  itemName: string;
  size: string;
  staffId: number | null;
  staffName: string | null;
  actorId: number;
  actorName: string;
  type: "opening_balance" | "receipt" | "issue" | "return" | "adjustment";
  quantity: number;
  stockDelta: number;
  relatedIssueId: number | null;
  conditionReturned: "serviceable" | "damaged" | null;
  replacementIssued: boolean;
  reason: string;
  occurredAt: string;
  remainingReturnQuantity: number;
};
type ItemDraft = {
  itemCode: string;
  itemName: string;
  description: string;
  size: string;
  openingQuantity: string;
  openingReason: string;
  reorderLevel: string;
  lastOrderDate: string;
};
type ItemEdit = {
  id: number;
  version: number;
  itemCode: string;
  itemName: string;
  description: string;
  size: string;
  reorderLevel: string;
  lastOrderDate: string;
  active: boolean;
};
type PrintData =
  | { kind: "stock"; items: UniformItem[] }
  | { kind: "transaction"; transaction: UniformTransaction };

const field =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const button =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
const emptyItem = (): ItemDraft => ({
  itemCode: "",
  itemName: "",
  description: "",
  size: "",
  openingQuantity: "",
  openingReason: "",
  reorderLevel: "",
  lastOrderDate: "",
});
function count(value: string, label: string, allowZero = false) {
  if (!/^\d+$/.test(value.trim())) throw new Error(`Enter a whole number for ${label}.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new Error(`${label} is outside the supported range.`);
  }
  return parsed;
}
function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
async function downloadUniformCsv(view: "stock" | "history") {
  const response = await fetch(`/api/operations/uniform-stock/export.csv?view=${view}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "Unable to download the Uniform Stock CSV.");
  }
  downloadFile(await response.blob(), `uniform-stock-${view}.csv`);
}

function StockPrintView({ data }: { data: PrintData }) {
  if (data.kind === "stock") {
    return (
      <section className="operations-print-document hidden">
        <MarvolOperationsBrandHeader title="Uniform Stock" subtitle="Current item counts and reorder levels" />
        <table className="mt-6 w-full border-collapse text-left text-sm">
          <thead><tr>{["Item", "Size", "On hand", "With staff", "Reorder level", "Status"].map((label) => <th key={label} className="border-b border-slate-400 p-2">{label}</th>)}</tr></thead>
          <tbody>{data.items.map((item) => (
            <tr key={item.id}>
              <td className="border-b border-slate-200 p-2">{item.itemName}{item.itemCode ? ` · ${item.itemCode}` : ""}</td>
              <td className="border-b border-slate-200 p-2">{item.size}</td>
              <td className="border-b border-slate-200 p-2">{item.currentQuantity}</td>
              <td className="border-b border-slate-200 p-2">{item.outstandingIssued}</td>
              <td className="border-b border-slate-200 p-2">{item.reorderLevel}</td>
              <td className="border-b border-slate-200 p-2">{item.active ? item.lowStock ? "Low stock" : "Active" : "Archived"}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>
    );
  }
  const { transaction } = data;
  return (
    <section className="operations-print-document hidden">
      <MarvolOperationsBrandHeader title="Uniform Stock Record" subtitle={`Transaction #${transaction.id}`} />
      <div className="mt-6 space-y-3 text-sm">
        <p><strong>Item:</strong> {transaction.itemName} · {transaction.size}</p>
        <p><strong>Transaction:</strong> {transaction.type.replaceAll("_", " ")}</p>
        <p><strong>Employee:</strong> {transaction.staffName ?? "Not staff-linked"}</p>
        <p><strong>Quantity:</strong> {transaction.quantity} · <strong>Stock change:</strong> {transaction.stockDelta > 0 ? "+" : ""}{transaction.stockDelta}</p>
        <p><strong>Recorded:</strong> {new Date(transaction.occurredAt).toLocaleString("en-US", { timeZone: "America/New_York" })}</p>
        {transaction.conditionReturned && <p><strong>Return condition:</strong> {transaction.conditionReturned}</p>}
        {transaction.replacementIssued && <p><strong>Replacement issued:</strong> Yes</p>}
        <p><strong>Reason:</strong> {transaction.reason}</p>
        <p><strong>Recorded by:</strong> {transaction.actorName}</p>
      </div>
    </section>
  );
}

export default function UniformStockPanel() {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const items = useOperations<UniformItem[]>("/uniform-stock");
  const transactions = useOperations<UniformTransaction[]>("/uniform-stock/transactions");
  const staff = useOperations<StaffOption[]>("/staff-options");
  const eligibleStaff = eligibleOperationsAssignees(staff.data ?? []);
  const activeItems = (items.data ?? []).filter((item) => item.active);
  const [newItem, setNewItem] = useState<ItemDraft>(emptyItem);
  const [editing, setEditing] = useState<ItemEdit | null>(null);
  const [transactionType, setTransactionType] = useState<"receipt" | "issue" | "return" | "adjustment">("issue");
  const [itemId, setItemId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [adjustmentDirection, setAdjustmentDirection] = useState<"increase" | "decrease">("increase");
  const [relatedIssueId, setRelatedIssueId] = useState("");
  const [conditionReturned, setConditionReturned] = useState<"serviceable" | "damaged">("serviceable");
  const [replacementIssued, setReplacementIssued] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const returnableIssues = (transactions.data ?? []).filter(
    (entry) => entry.type === "issue" && entry.remainingReturnQuantity > 0,
  );

  useEffect(() => {
    if (!printData) return;
    const timer = window.setTimeout(() => window.print(), 100);
    const finish = () => setPrintData(null);
    window.addEventListener("afterprint", finish);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", finish);
    };
  }, [printData]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["operations", currentUser?.id] });
  };

  const createItem = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operationsApi("/uniform-stock/items", "POST", {
        itemCode: newItem.itemCode.trim() || null,
        itemName: newItem.itemName.trim(),
        description: newItem.description.trim() || null,
        size: newItem.size.trim(),
        openingQuantity: count(newItem.openingQuantity, "opening quantity", true),
        openingReason: newItem.openingReason.trim(),
        reorderLevel: count(newItem.reorderLevel, "reorder level", true),
        lastOrderDate: newItem.lastOrderDate || null,
      });
      setNewItem(emptyItem());
      await refresh();
      setNotice("Item created with the manager-entered opening balance.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the stock item.");
    } finally {
      setBusy(false);
    }
  };

  const saveItem = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operationsApi(`/uniform-stock/items/${editing.id}`, "PATCH", {
        expectedVersion: editing.version,
        itemCode: editing.itemCode.trim() || null,
        itemName: editing.itemName.trim(),
        description: editing.description.trim() || null,
        size: editing.size.trim(),
        reorderLevel: count(editing.reorderLevel, "reorder level", true),
        lastOrderDate: editing.lastOrderDate || null,
        active: editing.active,
      });
      setEditing(null);
      await refresh();
      setNotice("Stock item details saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save the stock item.");
    } finally {
      setBusy(false);
    }
  };

  const recordTransaction = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body: Record<string, unknown> = {
        type: transactionType,
        quantity: count(quantity, "quantity"),
        reason: reason.trim(),
      };
      if (transactionType === "issue") {
        if (!itemId || !staffId) throw new Error("Choose an item and an eligible employee.");
        body.itemId = Number(itemId);
        body.staffId = Number(staffId);
      } else if (transactionType === "receipt") {
        if (!itemId) throw new Error("Choose an item to receive.");
        body.itemId = Number(itemId);
      } else if (transactionType === "adjustment") {
        if (!itemId) throw new Error("Choose an item to adjust.");
        body.itemId = Number(itemId);
        body.adjustmentDirection = adjustmentDirection;
      } else {
        if (!relatedIssueId) throw new Error("Choose an original issue to return.");
        body.relatedIssueId = Number(relatedIssueId);
        body.conditionReturned = conditionReturned;
        body.replacementIssued = replacementIssued;
      }
      await operationsApi("/uniform-stock/transactions", "POST", body);
      setQuantity("");
      setReason("");
      setRelatedIssueId("");
      setReplacementIssued(false);
      await refresh();
      setNotice("Stock transaction recorded.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to record the stock transaction.");
    } finally {
      setBusy(false);
    }
  };

  const editItem = (item: UniformItem) => setEditing({
    id: item.id,
    version: item.version,
    itemCode: item.itemCode ?? "",
    itemName: item.itemName,
    description: item.description ?? "",
    size: item.size,
    reorderLevel: String(item.reorderLevel),
    lastOrderDate: item.lastOrderDate ?? "",
    active: item.active,
  });

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
          title="Uniform Stock"
          subtitle="Track current quantities, staff issues, returns and reorder levels."
        />
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Stock starts empty. Enter and verify every opening balance; historical issues remain available for returns if an employee later becomes inactive or former.
        </div>

        <form onSubmit={(event) => void createItem(event)} className="space-y-3 rounded-xl border border-slate-200 p-4">
          <h3 className="font-semibold text-slate-900">Add stock item and opening balance</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1 text-sm"><span>Item</span><input className={field} value={newItem.itemName} onChange={(e) => setNewItem({ ...newItem, itemName: e.target.value })} required /></label>
            <label className="space-y-1 text-sm"><span>Item code (optional)</span><input className={field} value={newItem.itemCode} onChange={(e) => setNewItem({ ...newItem, itemCode: e.target.value })} /></label>
            <label className="space-y-1 text-sm"><span>Size</span><input className={field} value={newItem.size} onChange={(e) => setNewItem({ ...newItem, size: e.target.value })} required /></label>
            <label className="space-y-1 text-sm"><span>Description</span><input className={field} value={newItem.description} onChange={(e) => setNewItem({ ...newItem, description: e.target.value })} /></label>
            <label className="space-y-1 text-sm"><span>Opening quantity</span><input type="number" min="0" step="1" className={field} value={newItem.openingQuantity} onChange={(e) => setNewItem({ ...newItem, openingQuantity: e.target.value })} required /></label>
            <label className="space-y-1 text-sm"><span>Reorder threshold</span><input type="number" min="0" step="1" className={field} value={newItem.reorderLevel} onChange={(e) => setNewItem({ ...newItem, reorderLevel: e.target.value })} required /></label>
            <label className="space-y-1 text-sm"><span>Last order date (optional)</span><input type="date" className={field} value={newItem.lastOrderDate} onChange={(e) => setNewItem({ ...newItem, lastOrderDate: e.target.value })} /></label>
            <label className="space-y-1 text-sm"><span>Opening balance reason</span><input className={field} value={newItem.openingReason} onChange={(e) => setNewItem({ ...newItem, openingReason: e.target.value })} required /></label>
          </div>
          <button type="submit" disabled={busy} className={`${button} bg-emerald-800 text-white hover:bg-emerald-900`}>
            <Shirt className="h-4 w-4" aria-hidden="true" /> Add item
          </button>
        </form>

        <form onSubmit={(event) => void recordTransaction(event)} className="space-y-3 rounded-xl border border-slate-200 p-4">
          <h3 className="font-semibold text-slate-900">Record a stock transaction</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span>Transaction</span>
              <select className={field} value={transactionType} onChange={(e) => {
                const next = e.target.value as typeof transactionType;
                setTransactionType(next);
                setItemId("");
                setStaffId("");
                setRelatedIssueId("");
              }}>
                <option value="issue">Issue to employee</option>
                <option value="receipt">Receive stock</option>
                <option value="return">Return against past issue</option>
                <option value="adjustment">Stock adjustment</option>
              </select>
            </label>
            {transactionType === "return" ? (
              <label className="space-y-1 text-sm sm:col-span-2">
                <span>Original employee issue</span>
                <select className={field} value={relatedIssueId} onChange={(e) => setRelatedIssueId(e.target.value)} required>
                  <option value="">Select an open issue</option>
                  {returnableIssues.map((entry) => <option key={entry.id} value={entry.id}>{entry.staffName} · {entry.itemName} ({entry.size}) · {entry.remainingReturnQuantity} remaining · {new Date(entry.occurredAt).toLocaleDateString()}</option>)}
                </select>
                <span className="block text-xs text-slate-500">Historical issues remain returnable even when the employee is inactive or former.</span>
              </label>
            ) : (
              <label className="space-y-1 text-sm sm:col-span-2">
                <span>Item and size</span>
                <select className={field} value={itemId} onChange={(e) => setItemId(e.target.value)} required>
                  <option value="">Select item</option>
                  {activeItems.map((item) => <option key={item.id} value={item.id}>{item.itemName} · {item.size} · on hand {item.currentQuantity}</option>)}
                </select>
              </label>
            )}
            {transactionType === "issue" && (
              <label className="space-y-1 text-sm">
                <span>Eligible employee</span>
                <select className={field} value={staffId} onChange={(e) => setStaffId(e.target.value)} required>
                  <option value="">Select employee</option>
                  {eligibleStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
              </label>
            )}
            {transactionType === "adjustment" && (
              <label className="space-y-1 text-sm">
                <span>Adjustment</span>
                <select className={field} value={adjustmentDirection} onChange={(e) => setAdjustmentDirection(e.target.value as typeof adjustmentDirection)}>
                  <option value="increase">Increase stock</option>
                  <option value="decrease">Decrease stock</option>
                </select>
              </label>
            )}
            <label className="space-y-1 text-sm">
              <span>Quantity</span>
              <input type="number" min="1" step="1" className={field} value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
            </label>
            {transactionType === "return" && (
              <>
                <label className="space-y-1 text-sm">
                  <span>Returned condition</span>
                  <select className={field} value={conditionReturned} onChange={(e) => setConditionReturned(e.target.value as typeof conditionReturned)}>
                    <option value="serviceable">Serviceable — add back to stock</option>
                    <option value="damaged">Damaged — do not add to stock</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input type="checkbox" checked={replacementIssued} onChange={(e) => setReplacementIssued(e.target.checked)} />
                  Replacement issued
                </label>
              </>
            )}
            <label className="space-y-1 text-sm sm:col-span-2">
              <span>Reason</span>
              <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} required />
            </label>
          </div>
          {transactionType === "issue" && eligibleStaff.length === 0 && (
            <p className="text-sm text-amber-800">No active, non-former staff, supervisors or administrators are available for new issues.</p>
          )}
          {transactionType === "return" && returnableIssues.length === 0 && (
            <p className="text-sm text-slate-500">No previously issued items are currently returnable.</p>
          )}
          <button type="submit" disabled={busy || (transactionType === "issue" && eligibleStaff.length === 0) || (transactionType === "return" && returnableIssues.length === 0)} className={`${button} bg-slate-900 text-white hover:bg-slate-800`}>
            <Save className="h-4 w-4" aria-hidden="true" /> Record transaction
          </button>
        </form>

        {editing && (
          <form onSubmit={(event) => void saveItem(event)} className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
            <h3 className="font-semibold">Edit {editing.itemName} · {editing.size}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1 text-sm"><span>Item</span><input className={field} value={editing.itemName} onChange={(e) => setEditing({ ...editing, itemName: e.target.value })} required /></label>
              <label className="space-y-1 text-sm"><span>Item code</span><input className={field} value={editing.itemCode} onChange={(e) => setEditing({ ...editing, itemCode: e.target.value })} /></label>
              <label className="space-y-1 text-sm"><span>Size</span><input className={field} value={editing.size} onChange={(e) => setEditing({ ...editing, size: e.target.value })} required /></label>
              <label className="space-y-1 text-sm"><span>Description</span><input className={field} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label>
              <label className="space-y-1 text-sm"><span>Reorder threshold</span><input type="number" min="0" step="1" className={field} value={editing.reorderLevel} onChange={(e) => setEditing({ ...editing, reorderLevel: e.target.value })} required /></label>
              <label className="space-y-1 text-sm"><span>Last order date</span><input type="date" className={field} value={editing.lastOrderDate} onChange={(e) => setEditing({ ...editing, lastOrderDate: e.target.value })} /></label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
                Active for new transactions
              </label>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className={`${button} bg-emerald-800 text-white hover:bg-emerald-900`}><Save className="h-4 w-4" aria-hidden="true" /> Save item</button>
              <button type="button" onClick={() => setEditing(null)} className={`${button} border border-slate-300 text-slate-700 hover:bg-white`}>Cancel</button>
            </div>
          </form>
        )}

        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-slate-900">Current inventory</h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setPrintData({ kind: "stock", items: items.data ?? [] })} disabled={!items.data?.length} className={`${button} border border-slate-300 text-slate-700 hover:bg-slate-50`}>
                <Printer className="h-4 w-4" aria-hidden="true" /> Print stock list
              </button>
              <button type="button" onClick={() => void downloadUniformCsv("stock").catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to export."))} className={`${button} border border-slate-300 text-slate-700 hover:bg-slate-50`}>
                <Download className="h-4 w-4" aria-hidden="true" /> Stock CSV
              </button>
            </div>
          </div>
          {items.isLoading ? <p className="text-sm text-slate-500">Loading inventory…</p> :
            items.error ? <p role="alert" className="text-sm text-rose-700">Unable to load Uniform Stock.</p> :
              !items.data?.length ? <p className="text-sm text-slate-500">No stock items yet. Add the first item using a manager-verified opening count.</p> :
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[850px] text-left text-sm">
                    <thead><tr className="border-b text-slate-500">{["Item", "Size", "On hand", "With staff", "Reorder at", "Status", "Actions"].map((label) => <th key={label} className="p-2">{label}</th>)}</tr></thead>
                    <tbody>{items.data.map((item) => (
                      <tr key={item.id} className="border-b border-slate-100">
                        <td className="p-2">{item.itemName}{item.itemCode && <span className="block text-xs text-slate-500">{item.itemCode}</span>}</td>
                        <td className="p-2">{item.size}</td>
                        <td className="p-2 font-semibold">{item.currentQuantity}</td>
                        <td className="p-2">{item.outstandingIssued}</td>
                        <td className="p-2">{item.reorderLevel}</td>
                        <td className="p-2">
                          {!item.active ? <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">Archived</span> :
                            item.lowStock ? <span className="rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-800">Low stock</span> :
                              <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-800">In stock</span>}
                        </td>
                        <td className="p-2">
                          <button type="button" onClick={() => editItem(item)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label={`Edit ${item.itemName} ${item.size}`}><Pencil className="h-4 w-4" aria-hidden="true" /></button>
                          <button type="button" onClick={() => setEditing({ ...item, itemCode: item.itemCode ?? "", description: item.description ?? "", reorderLevel: String(item.reorderLevel), lastOrderDate: item.lastOrderDate ?? "", active: !item.active })} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label={item.active ? `Archive ${item.itemName} ${item.size}` : `Reactivate ${item.itemName} ${item.size}`}>
                            {item.active ? <Archive className="h-4 w-4" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
                          </button>
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>}
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-slate-900">Distribution and adjustment history</h3>
            <button type="button" onClick={() => void downloadUniformCsv("history").catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to export."))} className={`${button} border border-slate-300 text-slate-700 hover:bg-slate-50`}>
              <Download className="h-4 w-4" aria-hidden="true" /> History CSV
            </button>
          </div>
          {transactions.isLoading ? <p className="text-sm text-slate-500">Loading transaction history…</p> :
            transactions.error ? <p role="alert" className="text-sm text-rose-700">Unable to load transaction history.</p> :
              !transactions.data?.length ? <p className="text-sm text-slate-500">No stock transactions yet.</p> :
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[950px] text-left text-sm">
                    <thead><tr className="border-b text-slate-500">{["Date", "Type", "Item", "Employee", "Qty", "Stock change", "Reason", ""].map((label, i) => <th key={`${label}-${i}`} className="p-2">{label}</th>)}</tr></thead>
                    <tbody>{transactions.data.map((entry) => (
                      <tr key={entry.id} className="border-b border-slate-100">
                        <td className="p-2">{new Date(entry.occurredAt).toLocaleString("en-US", { timeZone: "America/New_York" })}</td>
                        <td className="p-2 capitalize">{entry.type.replaceAll("_", " ")}</td>
                        <td className="p-2">{entry.itemName} · {entry.size}</td>
                        <td className="p-2">{entry.staffName ?? "—"}</td>
                        <td className="p-2">{entry.quantity}</td>
                        <td className="p-2">{entry.stockDelta > 0 ? "+" : ""}{entry.stockDelta}</td>
                        <td className="max-w-[260px] truncate p-2" title={entry.reason}>{entry.reason}</td>
                        <td className="p-2"><button type="button" onClick={() => setPrintData({ kind: "transaction", transaction: entry })} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label={`Print transaction ${entry.id}`}><Printer className="h-4 w-4" aria-hidden="true" /></button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>}
        </div>
      </section>
      {printData && <StockPrintView data={printData} />}
    </div>
  );
}
