import { useEffect, useState } from "react";
import { AlertTriangle, Clock3, MapPin, Route, UserRound } from "lucide-react";
import { useGetInspectorWorkflow } from "@workspace/api-client-react";

function duration(seconds: number) {
  const safe = Math.max(0, seconds);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function deliveryLabel(status: string | null | undefined) {
  if (!status) return "Not requested";
  return {
    pending: "Pending",
    sending: "Sending",
    retrying: "Retrying",
    accepted: "Accepted by provider",
    disabled: "Disabled",
    not_configured: "Not configured",
    failed: "Failed",
    not_applicable: "Not applicable",
  }[status] ?? status;
}

export function InspectorWorkflowCard({ taskId, compact = false }: { taskId: number; compact?: boolean }) {
  const [now, setNow] = useState(Date.now());
  const { data, isLoading, error } = useGetInspectorWorkflow(taskId, {
    query: {
      queryKey: [`/api/inspector-workflow/${taskId}`],
      refetchInterval: 5000,
      staleTime: 0,
    },
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (isLoading) return <div className="mt-2 text-xs text-slate-400">Loading inspector assignment…</div>;
  if (error || !data) return <div className="mt-2 text-xs text-rose-600">Inspector assignment details are temporarily unavailable.</div>;

  const seconds = Math.max(0, Math.ceil((new Date(data.dueAt).getTime() - now) / 1000));
  const overdue = data.status === "overdue" || data.status === "escalated" || (data.status === "assigned" && seconds === 0);
  const approaching = data.status === "assigned" && seconds > 0 && seconds <= 120;
  const tone =
    data.status === "completed" ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : data.status === "escalated" ? "border-red-300 bg-red-50 text-red-900"
      : overdue ? "border-red-300 bg-red-50 text-red-900"
      : seconds <= 120 ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-blue-200 bg-blue-50 text-blue-900";
  const method = data.assignmentMethod === "fresh_gps" ? "GPS nearest" : "Workload fallback";

  return (
    <section className={`mt-2 rounded-xl border px-3 py-2.5 text-xs ${tone}`} aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2 font-bold">
        <span className="flex items-center gap-1">
          {(overdue || data.status === "escalated") && <AlertTriangle className="h-3.5 w-3.5" />}
          Inspector workflow · {data.status === "escalated" ? "Escalated / reassigned" : approaching ? "Approaching due time" : data.status}
        </span>
        <span className="flex items-center gap-1 tabular-nums">
          <Clock3 className="h-3.5 w-3.5" />
          {data.status === "completed" ? "Completed" : overdue ? `Overdue · ${duration(seconds)}` : `Due in ${duration(seconds)}`}
        </span>
      </div>
      {!compact && (
        <>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />Resolved area: {data.area.name}</span>
            <span className="flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />Assigned: {data.assignedStaff?.name ?? "Awaiting reassignment"}</span>
            <span className="flex items-center gap-1"><Route className="h-3.5 w-3.5" />{method}{data.assignmentDistanceMeters != null ? ` · ${Math.round(data.assignmentDistanceMeters)} m` : ""}</span>
            <span>Due: {new Date(data.dueAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          </div>
          <p className="mt-2 font-semibold">Completion email: {deliveryLabel(data.completionEmailDeliveryStatus)}</p>
          {data.history.length > 0 && (
            <ol className="mt-2 border-t border-current/15 pt-2 space-y-1">
              {data.history.map((item, index) => (
                <li key={`${item.createdAt}-${index}`}>
                  {item.event === "reassigned" ? "Reassigned" : "Assigned"} · {item.method === "fresh_gps" ? "GPS nearest" : "Workload fallback"} · {new Date(item.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}