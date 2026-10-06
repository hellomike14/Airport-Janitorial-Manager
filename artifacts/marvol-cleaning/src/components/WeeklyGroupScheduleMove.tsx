import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  previewTerminalGroupScheduleMove,
  useMoveTerminalGroupSchedule,
  type TerminalGroupSchedulePreview,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

type GroupKey = "terminal-a-east" | "terminal-a-west" | "terminal-b-east" | "terminal-b-west" |
  "terminal-c-135" | "terminal-c-246" | "top-terminal";

const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function WeeklyGroupScheduleMove({
  groups, staff,
}: {
  groups: readonly (readonly [GroupKey, string])[];
  staff: { id: number; name: string }[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [groupKey, setGroupKey] = useState<GroupKey | "">("");
  const [staffId, setStaffId] = useState("");
  const [preview, setPreview] = useState<TerminalGroupSchedulePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const reviewSequence = useRef(0);

  const move = useMoveTerminalGroupSchedule({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
        setPreview(null);
        setSuccess(t("assignments.weeklyMoved", { count: result.movedCount }));
        setError("");
      },
      onError: (err) => {
        setPreview(null);
        setError(err.status === 409
          ? t("assignments.weeklyConflict")
          : t("assignments.weeklyFailed"));
      },
    },
  });

  const review = async () => {
    if (!groupKey || !staffId || loading) return;
    const sequence = ++reviewSequence.current;
    setPreview(null);
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const current = await previewTerminalGroupScheduleMove({ groupKey, staffId: Number(staffId) });
      if (reviewSequence.current === sequence) setPreview(current);
    } catch {
      if (reviewSequence.current === sequence) setError(t("assignments.weeklyFailed"));
    } finally {
      if (reviewSequence.current === sequence) setLoading(false);
    }
  };

  const resetReview = () => {
    reviewSequence.current += 1;
    setPreview(null);
    setLoading(false);
    setError("");
    setSuccess("");
  };

  const target = staff.find((person) => person.id === Number(staffId));
  const groupLabel = groups.find(([key]) => key === groupKey)?.[1];
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900">{t("assignments.weeklyTitle")}</h2>
          <p className="text-sm text-slate-500">{t("assignments.weeklyIntro")}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => { setOpen(!open); resetReview(); }}>
          {open ? t("common.cancel") : t("assignments.weeklyAction")}
        </Button>
      </div>
      {open && (
        <div className="mt-5 space-y-4 border-t border-slate-100 pt-5">
          <p className="text-sm text-indigo-900">{t("assignments.weeklyScope")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-800">
              {t("assignments.selectGroup")}
              <select value={groupKey} onChange={(e) => { setGroupKey(e.target.value as GroupKey | ""); resetReview(); }}
                className="mt-1 block w-full rounded-xl border border-slate-200 bg-white p-2.5">
                <option value="">{t("assignments.chooseGroup")}</option>
                {groups.map(([key, label]) => <option key={key} value={key}>{t(`assignments.groups.${label}`)}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-800">
              {t("assignments.reassignTo")}
              <select value={staffId} onChange={(e) => { setStaffId(e.target.value); resetReview(); }}
                className="mt-1 block w-full rounded-xl border border-slate-200 bg-white p-2.5">
                <option value="">{t("assignments.chooseStaffMember")}</option>
                {staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>
          </div>
          <Button type="button" disabled={!groupKey || !staffId || loading || move.isPending} onClick={review}>
            {loading ? t("assignments.weeklyLoading") : t("assignments.weeklyReview")}
          </Button>
          {error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
          {success && <p role="status" className="text-sm font-semibold text-emerald-700">{success}</p>}
          {preview && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 space-y-3">
              <h3 className="font-bold text-indigo-950">
                {t("assignments.weeklyReviewTitle", {
                  group: groupLabel ? t(`assignments.groups.${groupLabel}`) : groupKey,
                  target: target?.name,
                })}
              </h3>
              {preview.rows.length === 0
                ? <p className="text-sm text-slate-700">{t("assignments.weeklyEmpty")}</p>
                : (
                  <div className="max-h-64 overflow-auto">
                    <ul className="space-y-2 text-sm text-slate-800">
                      {preview.rows.map((row) => (
                        <li key={row.id} className="rounded-lg border border-indigo-100 bg-white px-3 py-2">
                          <strong>{row.staffName} → {target?.name}</strong> · {t(`assignments.weekdays.${weekdays[row.dayOfWeek]}`)} · {row.areaName} · {row.startTime}–{row.endTime}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              {preview.conflict && <p role="alert" className="text-sm font-semibold text-rose-700">{t("assignments.weeklyDuplicate")}</p>}
              <p className="text-xs text-indigo-900">{t("assignments.weeklyConfirmScope")}</p>
              <Button type="button" disabled={preview.rows.length === 0 || preview.conflict || move.isPending}
                onClick={() => {
                  if (groupKey && staffId) move.mutate({ data: { groupKey, staffId: Number(staffId), snapshot: preview.snapshot } });
                }}>
                {move.isPending ? t("assignments.weeklySaving") : t("assignments.weeklyConfirm")}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}