import React, { useState, useMemo } from "react";
import { format } from "date-fns";
import { useTranslation, Trans } from "react-i18next";
import { getDateLocale } from "@/i18n/dateLocale";
import {
  useListAreas,
  useListAssignments,
  useCompleteTask,
  useUncompleteTask,
} from "@workspace/api-client-react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  Star,
  Plus,
  MapPin,
  CheckCircle2,
  Clock,
  Send,
  Loader2,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  User,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import RefreshButton from "@/components/RefreshButton";
import { StaffName } from "@/components/StaffName";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function useSpecialTasks(date: string, areaId?: number) {
  return useQuery({
    queryKey: ["/api/tasks/special", date, areaId],
    queryFn: async () => {
      const params = new URLSearchParams({ date });
      if (areaId) params.set("areaId", String(areaId));
      const res = await fetch(`${BASE}/api/tasks/special?${params}`);
      if (!res.ok) throw new Error("Failed to fetch special tasks");
      return res.json() as Promise<any[]>;
    },
  });
}

export default function SpecialRequests() {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateLocale(i18n.language);
  const { currentUser, effectiveRole } = useAuth();
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const [selectedDate, setSelectedDate] = useState(today);
  const [isCreating, setIsCreating] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const isStaff = effectiveRole === "staff";
  const canCreate = effectiveRole === "admin" || effectiveRole === "supervisor" || effectiveRole === "inspector";
  const canRespond = effectiveRole === "staff" || effectiveRole === "supervisor" || effectiveRole === "admin";

  const { data: areas } = useListAreas();
  const { data: dateAssignments = [] } = useListAssignments({ date: selectedDate });

  const staffAreaIds = useMemo(() => {
    if (!isStaff || !currentUser) return undefined;
    const ids = dateAssignments
      .filter((a) => a.staffId === currentUser.id)
      .map((a) => a.areaId);
    return ids.length > 0 ? ids : undefined;
  }, [isStaff, currentUser, dateAssignments]);

  const { data: specialTasks = [], isLoading } = useSpecialTasks(
    selectedDate,
    isStaff && staffAreaIds?.length === 1 ? staffAreaIds[0] : undefined
  );

  const filteredTasks = useMemo(() => {
    if (!isStaff || !staffAreaIds) return specialTasks;
    return specialTasks.filter((t: any) => staffAreaIds.includes(t.areaId));
  }, [specialTasks, isStaff, staffAreaIds]);

  const pendingSpecial = filteredTasks.filter((t: any) => !t.completed);
  const completedSpecial = filteredTasks.filter((t: any) => t.completed);

  const [formData, setFormData] = useState({ areaId: "", notes: "" });

  const createMutation = useMutation({
    mutationFn: async (body: { areaId: number; date: string; notes: string; createdById: number }) => {
      const resp = await fetch(`${BASE}/api/tasks/special`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error("Failed to create special request");
      return resp.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/tasks/special"] });
      qc.invalidateQueries({ queryKey: ["/api/tasks"] });
      setIsCreating(false);
      setFormData({ areaId: "", notes: "" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    createMutation.mutate({
      areaId: parseInt(formData.areaId),
      date: selectedDate,
      notes: formData.notes,
      createdById: currentUser.id,
    });
  };

  const handleRefresh = async () => {
    await qc.invalidateQueries({ queryKey: ["/api/tasks/special"] });
    setLastUpdated(new Date());
  };

  if (isStaff && !staffAreaIds) {
    return (
      <div className="space-y-8 max-w-4xl mx-auto pb-12">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900 flex items-center gap-3">
            <Star className="w-8 h-8 text-amber-500" />
            {t("specialRequests.title")}
          </h1>
        </div>
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white rounded-3xl border border-slate-200 border-dashed">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
          </div>
          <h3 className="text-lg font-bold text-slate-700">{t("specialRequests.noAreaAssigned")}</h3>
          <p className="text-slate-500 text-sm mt-1 max-w-xs">{t("specialRequests.noAreaAssignedDesc")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900 flex items-center gap-3">
            <Star className="w-8 h-8 text-amber-500" />
            {t("specialRequests.title")}
          </h1>
          <p className="text-slate-500 mt-1 font-medium">
            {isStaff ? t("specialRequests.staffSubtitle") : t("specialRequests.subtitle")}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
            <Clock className="w-4 h-4 text-blue-500" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-sm font-semibold text-slate-700 bg-transparent outline-none cursor-pointer"
            />
          </div>
          {canCreate && (
            <Button
              onClick={() => setIsCreating(!isCreating)}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md shadow-blue-600/20 font-bold"
            >
              <Plus className="w-4 h-4 mr-2" /> {t("specialRequests.newRequest")}
            </Button>
          )}
          <RefreshButton compact lastUpdated={lastUpdated} onRefresh={handleRefresh} />
        </div>
      </div>

      {isCreating && canCreate && (
        <div className="bg-blue-50 rounded-3xl p-6 border border-blue-100 shadow-sm animate-fade-in-up">
          <h3 className="text-lg font-bold text-blue-900 mb-4 flex items-center gap-2">
            <Star className="w-5 h-5 text-amber-500" /> {t("specialRequests.newSpecialRequest")}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-blue-900 mb-1">
                {t("specialRequests.targetArea")}
              </label>
              <select
                required
                value={formData.areaId}
                onChange={(e) => setFormData({ ...formData, areaId: e.target.value })}
                className="w-full bg-white border border-blue-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="">{t("specialRequests.chooseArea")}</option>
                {areas?.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-blue-900 mb-1">
                {t("specialRequests.requestDetails")}
              </label>
              <textarea
                required
                rows={3}
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder={t("specialRequests.requestPlaceholder")}
                className="w-full bg-white border border-blue-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
              />
            </div>

            <div className="flex flex-wrap justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsCreating(false)}
                className="rounded-xl text-blue-700 hover:bg-blue-100"
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md shadow-blue-600/20 px-6 font-bold"
              >
                {createMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t("specialRequests.submitting")}</>
                ) : (
                  <><Send className="w-4 h-4 mr-2" /> {t("specialRequests.submit")}</>
                )}
              </Button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            {t("specialRequests.totalRequests")}
          </p>
          <p className="text-3xl font-bold text-slate-800 mt-1">{filteredTasks.length}</p>
        </div>
        <div className="bg-amber-50 rounded-2xl border border-amber-200 px-5 py-4 shadow-sm">
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">
            {t("specialRequests.pending")}
          </p>
          <p className="text-3xl font-bold text-amber-700 mt-1">{pendingSpecial.length}</p>
        </div>
        <div className="bg-emerald-50 rounded-2xl border border-emerald-200 px-5 py-4 shadow-sm">
          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">
            {t("specialRequests.completed")}
          </p>
          <p className="text-3xl font-bold text-emerald-700 mt-1">{completedSpecial.length}</p>
        </div>
      </div>

      {isLoading && (
        <div className="p-8 text-center text-slate-500 animate-pulse bg-white rounded-3xl">Loading...</div>
      )}

      {pendingSpecial.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-slate-800 mb-3 flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-500" /> {t("specialRequests.pendingRequests")}
          </h2>
          <div className="space-y-3">
            {pendingSpecial.map((task: any) => (
              <RequestCard key={task.id} task={task} canRespond={canRespond} dateLocale={dateLocale} />
            ))}
          </div>
        </div>
      )}

      {completedSpecial.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-slate-800 mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" /> {t("specialRequests.completedRequests")}
          </h2>
          <div className="space-y-3">
            {completedSpecial.map((task: any) => (
              <RequestCard key={task.id} task={task} canRespond={false} dateLocale={dateLocale} />
            ))}
          </div>
        </div>
      )}

      {filteredTasks.length === 0 && !isCreating && !isLoading && (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white rounded-3xl border border-slate-200 border-dashed">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
            <ClipboardList className="w-8 h-8 text-blue-400" />
          </div>
          <h3 className="text-lg font-bold text-slate-700">
            {t("specialRequests.noRequests")}
          </h3>
          <p className="text-slate-500 text-sm mt-1 max-w-xs">
            {isStaff ? t("specialRequests.noRequestsStaff") : t("specialRequests.noRequestsDesc")}
          </p>
        </div>
      )}
    </div>
  );
}

function RequestCard({ task, canRespond, dateLocale }: { task: any; canRespond: boolean; dateLocale: any }) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState("");

  const completeMutation = useMutation({
    mutationFn: async (data: { completedById: number; completionNotes?: string }) => {
      const res = await fetch(`${BASE}/api/tasks/${task.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to complete task");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/tasks/special"] });
      qc.invalidateQueries({ queryKey: ["/api/tasks"] });
      setExpanded(false);
      setNotes("");
    },
  });

  const handleComplete = () => {
    if (!currentUser) return;
    completeMutation.mutate({
      completedById: currentUser.id,
      ...(notes.trim() ? { completionNotes: notes.trim() } : {}),
    });
  };

  return (
    <div
      className={`rounded-2xl border transition-all overflow-hidden ${
        task.completed
          ? "bg-slate-50 border-slate-200 opacity-80"
          : "bg-white border-amber-200 shadow-sm"
      }`}
    >
      <div className="p-5 flex items-start gap-4">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            task.completed
              ? "bg-emerald-100 text-emerald-600"
              : "bg-amber-100 text-amber-600"
          }`}
        >
          {task.completed ? (
            <CheckCircle2 className="w-5 h-5" />
          ) : (
            <Star className="w-5 h-5" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="flex items-center gap-1.5 text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
              <MapPin className="w-3 h-3" /> {task.areaName}
            </span>
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                task.completed
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {task.completed ? t("specialRequests.done") : t("specialRequests.pending")}
            </span>
          </div>

          <p
            className={`text-sm font-medium ${
              task.completed
                ? "text-slate-400 line-through"
                : "text-slate-800"
            }`}
          >
            {task.notes || task.taskName}
          </p>

          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-400">
            {task.createdByName && (
              <span className="flex items-center gap-1 text-blue-600 font-medium">
                <User className="w-3 h-3" />
                <Trans
                  i18nKey="specialRequests.createdBy"
                  values={{ name: task.createdByName }}
                  components={{ 1: <StaffName name={task.createdByName} active={task.createdByActive} /> }}
                  shouldUnescape
                />
              </span>
            )}
            {task.createdAt && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {format(new Date(task.createdAt), "h:mm a", { locale: dateLocale })}
              </span>
            )}
            {task.completed && task.completedAt && (
              <span className="flex items-center gap-1 text-emerald-600">
                <Clock className="w-3 h-3" />
                {t("specialRequests.doneAt", { time: format(new Date(task.completedAt), "h:mm a", { locale: dateLocale }) })}
              </span>
            )}
            {task.completedByName && (
              <span className="text-emerald-600 font-medium">
                <Trans
                  i18nKey="specialRequests.completedBy"
                  values={{ name: task.completedByName }}
                  components={{ 1: <StaffName name={task.completedByName} active={task.completedByActive} /> }}
                  shouldUnescape
                />
              </span>
            )}
          </div>
        </div>
      </div>

      {canRespond && !task.completed && (
        <div className="border-t border-amber-100 bg-amber-50/60">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-amber-800 hover:bg-amber-100/60 transition-colors"
          >
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> {t("specialRequests.respondToRequest")}
            </span>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {expanded && (
            <div className="px-5 pb-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-amber-900 mb-1.5 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" /> {t("specialRequests.completionNotes")} <span className="text-amber-500 font-normal">({t("common.optional")})</span>
                </label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t("specialRequests.completionNotesPlaceholder")}
                  className="w-full bg-white border border-amber-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30 resize-none"
                />
              </div>
              <Button
                onClick={handleComplete}
                disabled={completeMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md shadow-emerald-600/20 font-bold"
              >
                {completeMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t("specialRequests.completing")}</>
                ) : (
                  <><CheckCircle2 className="w-4 h-4 mr-2" /> {t("specialRequests.markDone")}</>
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
