import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  operationsApi,
  useOperations,
  currentGps,
  currentOrlandoDate,
  type TimeEntry,
  type Badge,
  type Incident,
  type Supply,
  type SupplyRequest,
  type AreaOption,
  type StaffOption,
  type ChecklistItem,
  type Inspection,
  type Audit,
  type MonthlyReport,
} from "@/lib/operationsApi";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const localInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const timeLabel = (value: string) =>
  new Date(value).toLocaleString(undefined, { timeZone: "America/New_York" });
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 space-y-4">
      <h2 className="font-semibold text-lg text-slate-900">{title}</h2>
      {children}
    </section>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm text-slate-700">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Empty({ children = "No records yet." }: { children?: ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>;
}
function useAction() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const run = async (work: () => Promise<unknown>, message = "Saved.") => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await qc.invalidateQueries({ queryKey: ["operations"] });
      await qc.invalidateQueries({ queryKey: ["/api/schedules"] });
      setNotice(message);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return {
    busy,
    run,
    feedback: (
      <>
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-emerald-700">
            {notice}
          </p>
        )}
      </>
    ),
  };
}
function useOptions() {
  const { currentUser, effectiveRole } = useAuth();
  const fetchList = async <T,>(url: string): Promise<T[]> => {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error("Unable to load options");
    return r.json();
  };
  const areas = useQuery({
    queryKey: ["operations-options", currentUser?.id, "areas"],
    queryFn: () => fetchList<AreaOption>("/api/areas"),
  });
  const staff = useQuery({
    queryKey: ["operations-options", currentUser?.id, "staff"],
    queryFn: () => fetchList<StaffOption>("/api/operations/staff-options"),
    enabled: effectiveRole === "admin" || effectiveRole === "supervisor",
  });
  return { areas: areas.data ?? [], staff: staff.data ?? [] };
}
function AreaSelect({
  areas,
  value,
  onChange,
}: {
  areas: AreaOption[];
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <Field label="Cleaning area">
      <select
        className={inputClass}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose area</option>
        {areas.map((a) => (
          <option key={a.id} value={a.id}>
            {a.terminal} · {a.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function TimeClock() {
  const {
    data: entry,
    isLoading,
    error,
  } = useOperations<TimeEntry | null>("/time/current");
  const action = useAction();
  const [breakMinutes, setBreakMinutes] = useState(0);
  const clock = () =>
    action.run(
      async () => {
        if (!navigator.onLine)
          throw new Error("Connect to the internet to record your clock time.");
        const location = await currentGps();
        return operationsApi(
          entry ? "/time/clock-out" : "/time/clock-in",
          "POST",
          { ...location, breakMinutes },
        );
      },
      entry ? "Clocked out. Your time is ready for review." : "Clocked in.",
    );
  return (
    <Panel title="My time clock">
      <p className="text-sm text-slate-600">
        {entry
          ? `On the clock since ${timeLabel(entry.clockIn)} (Orlando time).`
          : "Clock in at the MCO worksite. Time is recorded separately from area assignments."}
      </p>
      {entry && (
        <Field label="Unpaid break taken (minutes)">
          <input
            className={inputClass}
            type="number"
            min="0"
            max="1440"
            value={breakMinutes}
            onChange={(e) => setBreakMinutes(Number(e.target.value))}
          />
        </Field>
      )}
      <Button onClick={clock} disabled={action.busy || isLoading || !!error}>
        {action.busy ? "Recording…" : entry ? "Clock out" : "Clock in"}
      </Button>
      {error && (
        <p role="alert">Unable to load the time clock. Refresh to try again.</p>
      )}
      {action.feedback}
    </Panel>
  );
}
function TimePanel({ manager, admin }: { manager: boolean; admin: boolean }) {
  const { currentUser } = useAuth();
  const [from, setFrom] = useState(currentOrlandoDate().slice(0, 7) + "-01"),
    [to, setTo] = useState(currentOrlandoDate());
  const {
    data: entries = [],
    isLoading,
    error,
  } = useOperations<TimeEntry[]>(`/time?from=${from}&to=${to}`);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [reason, setReason] = useState(""),
    [breaks, setBreaks] = useState(0);
  const action = useAction();
  const edit = (e: TimeEntry) => {
    setEditing(e);
    setStart(localInput(e.clockIn));
    setEnd(localInput(e.clockOut ?? new Date().toISOString()));
    setBreaks(e.breakMinutes);
    setReason("");
  };
  return (
    <div className="space-y-5">
      <TimeClock />
      <Panel title={manager ? "Timesheets & payroll" : "My timesheets"}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="From">
            <input
              type="date"
              className={inputClass}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              className={inputClass}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
        </div>
        <p className="text-sm text-slate-500">
          Clock times below use Orlando time. Only approved, closed entries are
          included in payroll exports. Hours are actual recorded time less the
          unpaid break entered by the employee.
        </p>
        {admin && (
          <Button
            onClick={() =>
              action.run(async () => {
                const r = await fetch(
                  `/api/operations/payroll.csv?from=${from}&to=${to}`,
                );
                if (!r.ok) throw new Error((await r.json()).error);
                const url = URL.createObjectURL(await r.blob());
                const a = document.createElement("a");
                a.href = url;
                a.download = `marvol-payroll-${from}-${to}.csv`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }, "Payroll CSV downloaded.")
            }
            disabled={action.busy}
          >
            Export approved payroll CSV
          </Button>
        )}
        {isLoading ? (
          <Empty>Loading timesheets…</Empty>
        ) : error ? (
          <p role="alert">Unable to load time entries. Check the date range.</p>
        ) : entries.length === 0 ? (
          <Empty />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr>
                  {[
                    "Employee",
                    "Date",
                    "In",
                    "Out",
                    "Hours",
                    "Approval",
                    ...(manager ? ["Actions"] : []),
                  ].map((h) => (
                    <th key={h} className="p-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className="p-2">{e.staffName}</td>
                    <td className="p-2 whitespace-nowrap">{e.workDate}</td>
                    <td className="p-2">{timeLabel(e.clockIn)}</td>
                    <td className="p-2">
                      {e.clockOut ? timeLabel(e.clockOut) : "On shift"}
                    </td>
                    <td className="p-2">{(e.paidMinutes / 60).toFixed(2)}</td>
                    <td className="p-2">
                      {e.approvedAt ? "Approved" : "Pending"}
                      {e.correctionReason && (
                        <p className="text-xs text-slate-500">
                          Corrected: {e.correctionReason}
                        </p>
                      )}
                    </td>
                    {manager && (
                      <td className="p-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={action.busy}
                            onClick={() => edit(e)}
                          >
                            {e.clockOut ? "Correct" : "Close missed clock-out"}
                          </Button>
                          {e.clockOut &&
                            !e.approvedAt &&
                            e.staffId !== currentUser?.id && (
                              <Button
                                size="sm"
                                disabled={action.busy}
                                onClick={() =>
                                  action.run(
                                    () =>
                                      operationsApi(
                                        `/time/${e.id}/approve`,
                                        "POST",
                                      ),
                                    "Time approved.",
                                  )
                                }
                              >
                                Approve
                              </Button>
                            )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {editing && (
          <form
            className="rounded-lg bg-slate-50 p-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void action
                .run(
                  () =>
                    operationsApi(`/time/${editing.id}/correct`, "PATCH", {
                      clockIn: new Date(start).toISOString(),
                      clockOut: new Date(end).toISOString(),
                      breakMinutes: breaks,
                      reason,
                    }),
                  "Correction saved; approval reset.",
                )
                .then((ok) => {
                  if (ok) setEditing(null);
                });
            }}
          >
            <h3 className="font-semibold">
              Correct {editing.staffName}'s time · use this device's local time
            </h3>
            <p className="text-sm">
              Original times and this correction are retained in the audit
              history.
            </p>
            <Field label="Clock in (device local time)">
              <input
                type="datetime-local"
                className={inputClass}
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label="Clock out (device local time)">
              <input
                type="datetime-local"
                className={inputClass}
                required
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
            <Field label="Unpaid break minutes">
              <input
                type="number"
                min="0"
                className={inputClass}
                value={breaks}
                onChange={(e) => setBreaks(Number(e.target.value))}
              />
            </Field>
            <Field label="Reason for correction">
              <input
                className={inputClass}
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button disabled={action.busy}>Save correction</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
        {action.feedback}
      </Panel>
    </div>
  );
}
function SafetyPanel({ manager, admin }: { manager: boolean; admin: boolean }) {
  const { areas, staff } = useOptions();
  const badgeEligibleStaff = staff.filter(
    (person) => person.active === true && person.formerEmployee === false,
  );
  const badges = useOperations<Badge[]>("/badges"),
    incidents = useOperations<Incident[]>("/incidents");
  const action = useAction();
  const [staffId, setStaff] = useState(""),
    [badgeNumber, setBadge] = useState(""),
    [expiresOn, setExpires] = useState(""),
    [returnedOn, setReturned] = useState("");
  const [area, setArea] = useState(""),
    [category, setCategory] = useState("other"),
    [severity, setSeverity] = useState("low"),
    [description, setDescription] = useState(""),
    [immediateAction, setImmediateAction] = useState(""),
    [occurred, setOccurred] = useState(localInput(new Date().toISOString()));
  const [closing, setClosing] = useState<number | null>(null),
    [resolution, setResolution] = useState("");
  return (
    <div className="space-y-5">
      <Panel title="Airport badges">
        {badges.error && <p role="alert">Unable to load badges.</p>}
        {badges.data?.length ? (
          <div className="space-y-2">
            {badges.data.map((b) => (
              <div
                key={b.staffId}
                className={`p-3 rounded-lg ${b.returnRequired || (b.daysUntilExpiry <= 30 && !b.returnedOn) ? "bg-amber-50" : "bg-slate-50"}`}
              >
                <strong>{b.staffName}</strong> · {b.badgeNumber}
                <p className="text-sm">
                  Expires {b.expiresOn} ·{" "}
                  {b.returnedOn
                    ? `Returned ${b.returnedOn}`
                    : b.daysUntilExpiry < 0
                      ? "Expired"
                      : `${b.daysUntilExpiry} days remaining`}
                  {b.returnRequired && " · Return required"}
                </p>
                {admin && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setStaff(String(b.staffId));
                      setBadge(b.badgeNumber);
                      setExpires(b.expiresOn);
                      setReturned(b.returnedOn ?? "");
                    }}
                  >
                    Edit badge
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty />
        )}
        {admin && (
          <form
            className="grid sm:grid-cols-2 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(
                () =>
                  operationsApi(`/badges/${staffId}`, "PUT", {
                    badgeNumber,
                    expiresOn,
                    returnedOn: returnedOn || null,
                  }),
                "Badge saved.",
              );
            }}
          >
            <Field label="Employee">
              <select
                className={inputClass}
                value={staffId}
                required
                onChange={(e) => setStaff(e.target.value)}
              >
                <option value="">Choose employee</option>
                {badgeEligibleStaff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Badge number">
              <input
                required
                className={inputClass}
                value={badgeNumber}
                onChange={(e) => setBadge(e.target.value)}
              />
            </Field>
            <Field label="Expiration date">
              <input
                type="date"
                required
                className={inputClass}
                value={expiresOn}
                onChange={(e) => setExpires(e.target.value)}
              />
            </Field>
            <Field label="Returned date (optional)">
              <input
                type="date"
                className={inputClass}
                value={returnedOn}
                onChange={(e) => setReturned(e.target.value)}
              />
            </Field>
            <Button disabled={action.busy}>Save badge</Button>
          </form>
        )}
      </Panel>
      <Panel title="Report an incident">
        <p className="text-sm text-slate-500">
          Record the location, what happened, and the immediate action taken.
        </p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void action
              .run(
                () =>
                  operationsApi("/incidents", "POST", {
                    areaId: Number(area),
                    category,
                    severity,
                    description,
                    immediateAction,
                    occurredAt: new Date(occurred).toISOString(),
                  }),
                "Incident recorded.",
              )
              .then((ok) => {
                if (ok) {
                  setDescription("");
                  setImmediateAction("");
                }
              });
          }}
        >
          <AreaSelect areas={areas} value={area} onChange={setArea} />
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Category">
              <select
                className={inputClass}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {[
                  "injury",
                  "traffic",
                  "spill",
                  "bodily_fluid",
                  "equipment",
                  "security",
                  "other",
                ].map((c) => (
                  <option key={c} value={c}>
                    {c.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Severity">
              <select
                className={inputClass}
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
              >
                {["low", "medium", "high"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Occurred at (device local time)">
              <input
                type="datetime-local"
                required
                className={inputClass}
                value={occurred}
                onChange={(e) => setOccurred(e.target.value)}
              />
            </Field>
          </div>
          <Field label="What happened?">
            <textarea
              required
              className={inputClass}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="Immediate action taken">
            <textarea
              required
              className={inputClass}
              value={immediateAction}
              onChange={(e) => setImmediateAction(e.target.value)}
            />
          </Field>
          <Button disabled={action.busy}>Submit incident</Button>
        </form>
      </Panel>
      <Panel title={manager ? "Incident register" : "My incidents"}>
        {incidents.error && <p role="alert">Unable to load incidents.</p>}
        {incidents.data?.length ? (
          incidents.data.map((i) => (
            <div key={i.id} className="border-t py-3 space-y-1">
              <p>
                <strong>{i.areaName}</strong> ·{" "}
                {i.category.replaceAll("_", " ")} · {i.severity} · {i.status}
              </p>
              <p className="text-sm">{i.description}</p>
              <p className="text-sm text-slate-600">
                Action: {i.immediateAction}
              </p>
              <p className="text-xs text-slate-500">
                {i.staffName} · {timeLabel(i.occurredAt)}
              </p>
              {i.resolution && (
                <p className="text-sm">Resolution: {i.resolution}</p>
              )}
              {manager && i.status === "open" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setClosing(i.id);
                    setResolution("");
                  }}
                >
                  Close with resolution
                </Button>
              )}
            </div>
          ))
        ) : (
          <Empty />
        )}
        {closing && (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void action
                .run(
                  () =>
                    operationsApi(`/incidents/${closing}/close`, "POST", {
                      resolution,
                    }),
                  "Incident closed.",
                )
                .then((ok) => {
                  if (ok) setClosing(null);
                });
            }}
          >
            <Field label="Resolution">
              <textarea
                required
                className={inputClass}
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
              />
            </Field>
            <Button disabled={action.busy}>Save resolution</Button>
          </form>
        )}
      </Panel>
      {action.feedback}
    </div>
  );
}
function SuppliesPanel({ manager }: { manager: boolean }) {
  const supplies = useOperations<Supply[]>("/supplies"),
    requests = useOperations<SupplyRequest[]>("/supply-requests");
  const action = useAction();
  const [item, setItem] = useState(""),
    [quantity, setQuantity] = useState(1),
    [notes, setNotes] = useState("");
  const [name, setName] = useState(""),
    [unit, setUnit] = useState(""),
    [stock, setStock] = useState(0),
    [reorderLevel, setReorder] = useState(0);
  const [adjust, setAdjust] = useState<Supply | null>(null),
    [change, setChange] = useState(1),
    [reason, setReason] = useState("");
  return (
    <div className="space-y-5">
      <Panel title="Supply stock">
        {supplies.error && <p role="alert">Unable to load supplies.</p>}
        {supplies.data?.length ? (
          supplies.data.map((s) => (
            <div
              key={s.id}
              className={`rounded-lg p-3 flex flex-wrap items-center justify-between gap-2 ${s.stock <= s.reorderLevel ? "bg-amber-50" : "bg-slate-50"}`}
            >
              <div>
                <strong>{s.name}</strong>
                <p className="text-sm">
                  {s.stock} {s.unit} · reorder at {s.reorderLevel}
                  {s.stock <= s.reorderLevel && " · Low stock"}
                </p>
              </div>
              {manager && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAdjust(s);
                    setChange(1);
                    setReason("");
                  }}
                >
                  Adjust stock
                </Button>
              )}
            </div>
          ))
        ) : (
          <Empty />
        )}
        {adjust && (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void action
                .run(
                  () =>
                    operationsApi(`/supplies/${adjust.id}/adjust`, "POST", {
                      quantity: change,
                      reason,
                    }),
                  "Stock adjusted.",
                )
                .then((ok) => {
                  if (ok) setAdjust(null);
                });
            }}
          >
            <h3 className="font-semibold">{adjust.name}</h3>
            <Field label="Change in stock (negative to remove)">
              <input
                type="number"
                required
                className={inputClass}
                value={change}
                onChange={(e) => setChange(Number(e.target.value))}
              />
            </Field>
            <Field label="Reason">
              <input
                required
                className={inputClass}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Button disabled={action.busy}>Save stock change</Button>
          </form>
        )}
        {manager && (
          <details>
            <summary className="cursor-pointer font-medium">
              Add stock item
            </summary>
            <form
              className="grid sm:grid-cols-2 gap-3 mt-3"
              onSubmit={(e) => {
                e.preventDefault();
                void action
                  .run(
                    () =>
                      operationsApi("/supplies", "POST", {
                        name,
                        unit,
                        stock,
                        reorderLevel,
                      }),
                    "Supply item added.",
                  )
                  .then((ok) => {
                    if (ok) {
                      setName("");
                      setUnit("");
                    }
                  });
              }}
            >
              <Field label="Item name">
                <input
                  required
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="Unit (bottles, bags, etc.)">
                <input
                  required
                  className={inputClass}
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </Field>
              <Field label="Opening stock">
                <input
                  type="number"
                  min="0"
                  className={inputClass}
                  value={stock}
                  onChange={(e) => setStock(Number(e.target.value))}
                />
              </Field>
              <Field label="Reorder level">
                <input
                  type="number"
                  min="0"
                  className={inputClass}
                  value={reorderLevel}
                  onChange={(e) => setReorder(Number(e.target.value))}
                />
              </Field>
              <Button disabled={action.busy}>Add item</Button>
            </form>
          </details>
        )}
      </Panel>
      <Panel title="Request supplies">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void action
              .run(
                () =>
                  operationsApi("/supply-requests", "POST", {
                    itemId: Number(item),
                    quantity,
                    notes,
                  }),
                "Supply request sent.",
              )
              .then((ok) => {
                if (ok) setNotes("");
              });
          }}
        >
          <Field label="Supply">
            <select
              required
              className={inputClass}
              value={item}
              onChange={(e) => setItem(e.target.value)}
            >
              <option value="">Choose supply</option>
              {supplies.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.unit})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity">
            <input
              type="number"
              min="1"
              required
              className={inputClass}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </Field>
          <Field label="Notes">
            <input
              className={inputClass}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <Button disabled={action.busy}>Send request</Button>
        </form>
      </Panel>
      <Panel title={manager ? "Supply requests" : "My supply requests"}>
        {requests.error && <p role="alert">Unable to load supply requests.</p>}
        {requests.data?.length ? (
          requests.data.map((r) => (
            <div
              key={r.id}
              className="border-t py-3 flex flex-wrap justify-between gap-2"
            >
              <div>
                <p>
                  <strong>{r.itemName}</strong> · {r.quantity} {r.unit} ·{" "}
                  {r.status}
                </p>
                <p className="text-sm text-slate-500">
                  {r.staffName} · {r.notes}
                </p>
              </div>
              {manager && r.status === "pending" && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={action.busy}
                    onClick={() =>
                      action.run(
                        () =>
                          operationsApi(
                            `/supply-requests/${r.id}/handle`,
                            "POST",
                            { status: "fulfilled" },
                          ),
                        "Request fulfilled; stock deducted.",
                      )
                    }
                  >
                    Fulfill
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={action.busy}
                    onClick={() =>
                      action.run(
                        () =>
                          operationsApi(
                            `/supply-requests/${r.id}/handle`,
                            "POST",
                            { status: "declined" },
                          ),
                        "Request declined.",
                      )
                    }
                  >
                    Decline
                  </Button>
                </div>
              )}
            </div>
          ))
        ) : (
          <Empty />
        )}
      </Panel>
      {action.feedback}
    </div>
  );
}
const recommended: ChecklistItem[] = [
  {
    taskName: "Sweep assigned floors, corners and pedestrian routes",
    photoRequired: true,
  },
  { taskName: "Empty trash bins and replace liners", photoRequired: true },
  { taskName: "Clean assigned stairwells and landings", photoRequired: false },
  {
    taskName: "Clean elevators and sanitize high-touch surfaces",
    photoRequired: false,
  },
  {
    taskName: "Spot-clean spills, stains, glass and signs as required",
    photoRequired: true,
  },
  {
    taskName: "Inspect drains and walkways; report hazards and hand over",
    photoRequired: false,
  },
];
function QualityPanel({ admin }: { admin: boolean }) {
  const { areas } = useOptions();
  const [area, setArea] = useState("");
  const [items, setItems] = useState<ChecklistItem[]>(recommended);
  const profile = useOperations<{ items: ChecklistItem[] } | null>(
    `/checklists/${area || "0"}`,
    !!area,
  );
  useEffect(() => {
    setItems(profile.data?.items ?? recommended);
  }, [profile.data, area]);
  const inspections = useOperations<{
    checks: string[];
    target: number;
    inspections: Inspection[];
  }>("/inspections");
  const [inspectionArea, setInspectionArea] = useState(""),
    [day, setDay] = useState(currentOrlandoDate()),
    [checks, setChecks] = useState<boolean[]>(Array(15).fill(false)),
    [notes, setNotes] = useState("");
  const action = useAction();
  return (
    <div className="space-y-5">
      {admin && (
        <Panel title="Area checklist · 5–7 tasks">
          <p className="text-sm text-slate-500">
            Review this suggested checklist against the contract before saving.
            It applies when the next daily sheet is created; existing work
            records stay intact. An after photo is required for tasks you mark
            below.
          </p>
          <AreaSelect areas={areas} value={area} onChange={setArea} />
          {area && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void action.run(
                  () => operationsApi(`/checklists/${area}`, "PUT", { items }),
                  "Checklist saved for future daily sheets.",
                );
              }}
            >
              {profile.error && (
                <p role="alert">
                  Unable to load this area's checklist. Refresh before editing.
                </p>
              )}
              {items.map((item, i) => (
                <div
                  key={i}
                  className="grid sm:grid-cols-[1fr_auto_auto] gap-2 items-center"
                >
                  <Field label={`Task ${i + 1}`}>
                    <input
                      className={inputClass}
                      required
                      maxLength={500}
                      value={item.taskName}
                      onChange={(e) =>
                        setItems(
                          items.map((it, idx) =>
                            idx === i
                              ? { ...it, taskName: e.target.value }
                              : it,
                          ),
                        )
                      }
                    />
                  </Field>
                  <label className="text-sm flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={item.photoRequired}
                      onChange={(e) =>
                        setItems(
                          items.map((it, idx) =>
                            idx === i
                              ? { ...it, photoRequired: e.target.checked }
                              : it,
                          ),
                        )
                      }
                    />
                    After photo required
                  </label>
                  {item.notes && (
                    <details className="sm:col-span-3">
                      <summary className="text-sm cursor-pointer">
                        Detailed cleaning duties
                      </summary>
                      <textarea
                        className={inputClass + " min-h-32 mt-2"}
                        value={item.notes}
                        onChange={(e) =>
                          setItems(
                            items.map((it, idx) =>
                              idx === i ? { ...it, notes: e.target.value } : it,
                            ),
                          )
                        }
                      />
                    </details>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={items.length <= 5}
                    onClick={() =>
                      setItems(items.filter((_, idx) => idx !== i))
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <div className="flex gap-2 flex-wrap">
                <Button
                  type="button"
                  variant="outline"
                  disabled={items.length >= 7}
                  onClick={() =>
                    setItems([...items, { taskName: "", photoRequired: false }])
                  }
                >
                  Add task
                </Button>
                <Button
                  disabled={action.busy || profile.isLoading || !!profile.error}
                >
                  Save checklist
                </Button>
              </div>
            </form>
          )}
        </Panel>
      )}
      <Panel title="15-point quality inspection · target 90%">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void action
              .run(
                () =>
                  operationsApi("/inspections", "POST", {
                    areaId: Number(inspectionArea),
                    inspectionDate: day,
                    checks,
                    notes,
                  }),
                "Inspection saved.",
              )
              .then((ok) => {
                if (ok) {
                  setChecks(Array(15).fill(false));
                  setNotes("");
                }
              });
          }}
        >
          <AreaSelect
            areas={areas}
            value={inspectionArea}
            onChange={setInspectionArea}
          />
          <Field label="Inspection date">
            <input
              type="date"
              required
              max={currentOrlandoDate()}
              className={inputClass}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </Field>
          <p className="text-sm">
            Check each condition that passes. Unchecked conditions count as
            failures.
          </p>
          {inspections.data?.checks.map((label, i) => (
            <label key={label} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={checks[i]}
                onChange={(e) =>
                  setChecks(
                    checks.map((c, idx) => (idx === i ? e.target.checked : c)),
                  )
                }
              />
              {label}
            </label>
          ))}
          <p className="font-semibold">
            Score: {Math.round((checks.filter(Boolean).length / 15) * 100)}%
          </p>
          <Field label="Notes / corrective actions">
            <textarea
              className={inputClass}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <Button disabled={action.busy || !inspections.data}>
            Save inspection
          </Button>
        </form>
      </Panel>
      <Panel title="Inspection history">
        {inspections.error && <p role="alert">Unable to load inspections.</p>}
        {inspections.data?.inspections.length ? (
          inspections.data.inspections.map((i) => (
            <div
              key={i.id}
              className={`p-3 rounded-lg ${i.score < 90 ? "bg-amber-50" : "bg-emerald-50"}`}
            >
              <strong>
                {i.areaName} · {i.score}% ·{" "}
                {i.score >= 90 ? "Pass" : "Follow up"}
              </strong>
              <p className="text-sm">
                {i.inspectionDate} · {i.staffName} · {i.notes}
              </p>
            </div>
          ))
        ) : (
          <Empty />
        )}
      </Panel>
      {action.feedback}
    </div>
  );
}
function ReadinessPanel({ admin }: { admin: boolean }) {
  const [day, setDay] = useState(currentOrlandoDate());
  const audit = useOperations<Audit>(`/audit?date=${day}`);
  const action = useAction();
  const [confirm, setConfirm] = useState(false);
  type Settings = {
    gpsRequired: boolean;
    siteLatitude: number;
    siteLongitude: number;
    radiusMeters: number;
    maxAccuracyMeters: number;
  };
  const settings = useOperations<Settings>("/settings", admin);
  const [gpsSettings, setGpsSettings] = useState<Settings | null>(null);
  useEffect(() => {
    if (settings.data) setGpsSettings(settings.data);
  }, [settings.data]);
  return (
    <div className="space-y-5">
      <Panel title="Coverage & record checks">
        <Field label="Work date">
          <input
            type="date"
            className={inputClass}
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </Field>
        {audit.isLoading ? (
          <Empty>Checking records…</Empty>
        ) : audit.error ? (
          <p role="alert">Unable to check records.</p>
        ) : (
          audit.data && (
            <>
              <h3 className="font-semibold">
                Uncovered areas ({audit.data.uncoveredAreas.length})
              </h3>
              {audit.data.uncoveredAreas.length ? (
                audit.data.uncoveredAreas.map((a) => (
                  <p key={a.id} className="text-sm">
                    {a.terminal} · {a.name} ·{" "}
                    <Link
                      className="text-emerald-700 underline"
                      href="/assignments"
                    >
                      Assign coverage
                    </Link>
                  </p>
                ))
              ) : (
                <Empty>
                  Every active area has a current employee assigned.
                </Empty>
              )}
              <h3 className="font-semibold">
                Former / inactive staff on recurring schedules (
                {audit.data.ineligibleSchedules.length})
              </h3>
              {audit.data.ineligibleSchedules.map((s) => (
                <div key={s.id} className="flex gap-3 items-center text-sm">
                  <span>
                    {s.staffName} · shift #{s.id}
                  </span>
                  {admin && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={action.busy}
                      onClick={() =>
                        action.run(async () => {
                          const r = await fetch(`/api/schedules/${s.id}`, {
                            method: "DELETE",
                          });
                          if (!r.ok) throw new Error("Unable to remove shift");
                        }, "Inactive shift removed.")
                      }
                    >
                      Remove shift
                    </Button>
                  )}
                </div>
              ))}
              <h3 className="font-semibold">
                Duplicate shift groups ({audit.data.duplicateShifts.length})
              </h3>
              {audit.data.duplicateShifts.map((s, i) => (
                <p key={i} className="text-sm">
                  {s.staffName} ·{" "}
                  {
                    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
                      s.dayOfWeek
                    ]
                  }{" "}
                  {s.startTime}–{s.endTime} · {s.ids.length} copies
                </p>
              ))}
              {admin && audit.data.duplicateShifts.length > 0 && (
                <div className="space-y-2">
                  <label className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={confirm}
                      onChange={(e) => setConfirm(e.target.checked)}
                    />
                    Consolidate exact staff/day/time matches; combine notes and
                    retain area assignments.
                  </label>
                  <Button
                    disabled={!confirm || action.busy}
                    onClick={() =>
                      action
                        .run(
                          () => operationsApi("/schedules/consolidate", "POST"),
                          "Exact duplicate shifts consolidated.",
                        )
                        .then((ok) => {
                          if (ok) setConfirm(false);
                        })
                    }
                  >
                    Consolidate duplicate shifts
                  </Button>
                </div>
              )}
              <h3 className="font-semibold">
                Duplicate checklist tasks ({audit.data.duplicateTasks.length})
              </h3>
              {audit.data.duplicateTasks.map((t, i) => (
                <p key={i} className="text-sm">
                  Area #{t.areaId} · {t.taskName} · {t.copies} copies
                </p>
              ))}
              <p className="text-sm text-slate-500">
                Existing checklist history is retained. Configure a shorter
                checklist under Quality to prevent future oversized daily
                sheets.
              </p>
              <h3 className="font-semibold">
                Current staff missing email (
                {audit.data.missingStaffEmails.length})
              </h3>
              {audit.data.missingStaffEmails.map((s) => (
                <p key={s.id} className="text-sm">
                  {s.name} ·{" "}
                  <Link className="underline text-emerald-700" href="/staff">
                    Update staff directory
                  </Link>
                </p>
              ))}
              <p className="text-sm text-slate-500">
                {audit.data.archivedAreas.length} legacy areas are archived.
              </p>
              <Link
                href="/employee-portal"
                className="underline text-emerald-700 text-sm"
              >
                Manage recurring shifts
              </Link>
            </>
          )
        )}
      </Panel>
      {admin && gpsSettings && (
        <Panel title="Clock-in worksite settings">
          <form
            className="grid sm:grid-cols-2 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(
                () => operationsApi("/settings", "PUT", gpsSettings),
                "Clock-in settings saved.",
              );
            }}
          >
            {(
              [
                ["siteLatitude", "Worksite latitude"],
                ["siteLongitude", "Worksite longitude"],
                ["radiusMeters", "Allowed radius (meters)"],
                ["maxAccuracyMeters", "Maximum GPS error (meters)"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  required
                  type="number"
                  step={key.includes("Meters") ? "1" : "any"}
                  className={inputClass}
                  value={gpsSettings[key]}
                  onChange={(e) =>
                    setGpsSettings({
                      ...gpsSettings,
                      [key]: Number(e.target.value),
                    })
                  }
                />
              </Field>
            ))}
            <label className="text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={gpsSettings.gpsRequired}
                onChange={(e) =>
                  setGpsSettings({
                    ...gpsSettings,
                    gpsRequired: e.target.checked,
                  })
                }
              />
              Enforce worksite boundary at clock-in
            </label>
            <Button disabled={action.busy}>Save GPS settings</Button>
          </form>
          <p className="text-sm text-slate-500">
            Default boundary: 5 km around MCO. Confirm the boundary covers all
            contracted garages. Clock-out records GPS without blocking
            departure.
          </p>
        </Panel>
      )}
      {action.feedback}
    </div>
  );
}
function MonthlyPanel({ admin }: { admin: boolean }) {
  const today = currentOrlandoDate();
  const last = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  last.setUTCMonth(last.getUTCMonth() - 1);
  const [month, setMonth] = useState(last.toISOString().slice(0, 7));
  const report = useOperations<MonthlyReport>(
    `/monthly-report/${month}`,
    !!month,
  );
  const action = useAction();
  const r = report.data;
  return (
    <Panel title="GOAA monthly operations report">
      <div className="flex flex-wrap gap-3 print:hidden">
        <Field label="Month">
          <input
            type="month"
            className={inputClass}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </Field>
        <Button variant="outline" disabled={!r} onClick={() => window.print()}>
          Print / save PDF
        </Button>
        {admin && (
          <Button
            disabled={action.busy || !month}
            onClick={() =>
              action.run(
                () => operationsApi(`/monthly-report/${month}/refresh`, "POST"),
                "Monthly report regenerated from current records.",
              )
            }
          >
            Regenerate saved report
          </Button>
        )}
      </div>
      <p className="text-sm text-slate-500">
        The prior month's report is saved automatically while the server runs.
        Review it before sharing with GOAA. Regenerate after late corrections.
      </p>
      {report.isLoading ? (
        <Empty>Generating report…</Empty>
      ) : report.error ? (
        <p role="alert">Unable to generate report.</p>
      ) : (
        r && (
          <div className="space-y-4">
            <h3 className="font-semibold">
              Marvol Enterprises · MCO parking garages · {r.month}
            </h3>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <p>
                Checklist completion:{" "}
                <strong>
                  {r.completedTasks} / {r.totalTasks} ({r.completionPercent}%)
                </strong>
              </p>
              <p>
                Completed tasks with after photos:{" "}
                <strong>{r.photoEvidence}</strong>
              </p>
              <p>
                Issues resolved:{" "}
                <strong>
                  {r.issues.resolved} / {r.issues.total}
                </strong>
              </p>
              <p>
                Incidents: <strong>{r.incidents.total}</strong> ·{" "}
                {r.incidents.open} open · {r.incidents.highSeverity} high
                severity
              </p>
              <p>
                Inspections: <strong>{r.inspections.total}</strong> ·{" "}
                {r.inspections.passed} met the 90% target · average{" "}
                {r.inspections.averageScore ?? "N/A"}%
              </p>
              <p>
                Approved hours:{" "}
                <strong>{r.timekeeping.approvedHours.toFixed(2)}</strong> ·{" "}
                {r.timekeeping.unapprovedEntries} pending entries ·{" "}
                {r.timekeeping.openEntries} open entries
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr>
                    {[
                      "Area",
                      "Terminal",
                      "Completed",
                      "Total",
                      "After photos",
                    ].map((h) => (
                      <th key={h} className="p-2">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.areaPerformance.map((a) => (
                    <tr key={a.areaId} className="border-t">
                      <td className="p-2">{a.areaName}</td>
                      <td className="p-2">{a.terminal}</td>
                      <td className="p-2">{a.completed}</td>
                      <td className="p-2">{a.total}</td>
                      <td className="p-2">{a.photoEvidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">
              Generated {timeLabel(r.generatedAt)} · Orlando time
            </p>
          </div>
        )
      )}
      {action.feedback}
    </Panel>
  );
}
export default function Operations() {
  const { effectiveRole } = useAuth();
  const manager = effectiveRole === "admin" || effectiveRole === "supervisor",
    admin = effectiveRole === "admin";
  const tabs = manager
    ? [
        "Time & payroll",
        "Safety",
        "Supplies",
        "Quality",
        "Readiness",
        "Monthly report",
      ]
    : ["My time", "Safety", "Supplies"];
  const [tab, setTab] = useState(0);
  useEffect(() => {
    setTab(0);
  }, [effectiveRole]);
  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h1 className="text-2xl font-bold text-slate-900">Operations</h1>
        <p className="text-sm text-slate-500 mt-1">
          Timekeeping, safety, supplies and service records.
        </p>
      </div>
      <div
        className="flex gap-2 overflow-x-auto pb-2 print:hidden"
        role="tablist"
        aria-label="Operations sections"
      >
        {tabs.map((label, i) => (
          <Button
            key={label}
            role="tab"
            aria-selected={tab === i}
            variant={tab === i ? "default" : "outline"}
            onClick={() => setTab(i)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 0 && <TimePanel manager={manager} admin={admin} />}
        {tab === 1 && <SafetyPanel manager={manager} admin={admin} />}
        {tab === 2 && <SuppliesPanel manager={manager} />}
        {manager && tab === 3 && <QualityPanel admin={admin} />}
        {manager && tab === 4 && <ReadinessPanel admin={admin} />}
        {manager && tab === 5 && <MonthlyPanel admin={admin} />}
      </div>
    </div>
  );
}
