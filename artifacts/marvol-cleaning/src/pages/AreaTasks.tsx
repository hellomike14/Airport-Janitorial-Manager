import React, { useState } from "react";
import { useRoute } from "wouter";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { getDateLocale } from "@/i18n/dateLocale";
import {
  useListTasks,
  getListTasksQueryKey,
  useCompleteTask,
  useUncompleteTask,
  useCompleteAllTasks,
  useListAreas,
  useListAreaEffectiveTasks,
  getListAreaEffectiveTasksQueryKey,
  useAddAreaTaskExclusion,
  useRemoveAreaTaskExclusion,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Clock, User, AlertCircle, ArrowLeft, Camera, ToggleLeft, ToggleRight, Loader2, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TaskPhotoToggle } from "@/components/TaskPhotos";
import { StaffName } from "@/components/StaffName";
import { useAuth } from "@/contexts/AuthContext";

export default function AreaTasks() {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateLocale(i18n.language);
  const [, params] = useRoute("/areas/:areaId");
  const areaId = params?.areaId ? parseInt(params.areaId) : 0;
  const [selectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const queryClient = useQueryClient();

  const { effectiveRole, currentUser } = useAuth();
  const isAdmin = effectiveRole === "admin";

  const { data: areas } = useListAreas();
  const areaInfo = areas?.find(a => a.id === areaId);

  const { data: tasks, isLoading } = useListTasks({ areaId, date: selectedDate }, {
    query: {
      queryKey: getListTasksQueryKey({ areaId, date: selectedDate }),
      enabled: !!areaId,
    }
  });

  const { data: effectiveTasks, refetch: refetchEffective } = useListAreaEffectiveTasks(areaId, {
    query: {
      queryKey: getListAreaEffectiveTasksQueryKey(areaId),
      enabled: !!areaId && isAdmin,
    },
  });

  const onExclusionChange = () => {
    refetchEffective();
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  };

  const addExclusionMutation = useAddAreaTaskExclusion({
    mutation: { onSuccess: onExclusionChange },
  });
  const removeExclusionMutation = useRemoveAreaTaskExclusion({
    mutation: { onSuccess: onExclusionChange },
  });

  const togglingTaskName = addExclusionMutation.isPending
    ? (addExclusionMutation.variables?.data.taskName ?? null)
    : removeExclusionMutation.isPending
      ? (removeExclusionMutation.variables?.data.taskName ?? null)
      : null;

  const handleToggleExclusion = (taskName: string, excluded: boolean) => {
    if (excluded) {
      removeExclusionMutation.mutate({ areaId, data: { taskName } });
    } else {
      addExclusionMutation.mutate({
        areaId,
        data: { taskName, createdById: currentUser?.id ?? null },
      });
    }
  };

  const currentUserId = currentUser?.id ?? 1;

  const completeMutation = useCompleteTask({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] })
    }
  });

  const uncompleteMutation = useUncompleteTask({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] })
    }
  });

  const completeAllMutation = useCompleteAllTasks({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] })
    }
  });

  const toggleTask = (task: any) => {
    if (task.completed) {
      uncompleteMutation.mutate({ id: task.id });
    } else {
      completeMutation.mutate({ id: task.id, data: { completedById: currentUserId } });
    }
  };

  const handleCompleteAll = () => {
    completeAllMutation.mutate({
      data: { areaId, date: selectedDate, completedById: currentUserId }
    });
  };

  if (isLoading) {
    return <div className="p-8 text-center text-slate-500 font-medium animate-pulse">{t("areaTasks.loadingTaskSheet")}</div>;
  }

  const completedCount = tasks?.filter(t => t.completed).length || 0;
  const totalCount = tasks?.length || 0;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <Link href="/areas" className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-accent transition-colors">
        <ArrowLeft className="w-4 h-4 mr-1" /> {t("areaTasks.backToAreaList")}
      </Link>

      <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <StatusBadge status="info">{areaInfo?.terminal || t("areaTasks.terminal")}</StatusBadge>
              <span className="text-sm font-semibold text-slate-400 uppercase tracking-wider">{format(new Date(selectedDate), "MMM do, yyyy", { locale: dateLocale })}</span>
            </div>
            <h1 className="text-4xl font-display font-bold text-slate-900">{areaInfo?.name || t("areaTasks.area", { id: areaId })}</h1>
            <p className="text-slate-500 mt-2 font-medium flex items-center gap-2">
              <User className="w-4 h-4" /> 
              {t("areaTasks.assigned")} <span className="text-slate-800">
                {tasks?.[0]?.assignedToName ? (
                  <StaffName name={tasks[0].assignedToName} active={tasks[0].assignedToActive} />
                ) : (
                  t("areaTasks.noSpecificAssignment")
                )}
              </span>
            </p>
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 min-w-[200px]">
            <div className="flex justify-between items-end mb-2">
              <span className="text-sm font-bold text-slate-500 uppercase tracking-wider">{t("areaTasks.progress")}</span>
              <span className="text-2xl font-display font-bold text-accent">{completedCount}/{totalCount}</span>
            </div>
            <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-accent rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <p className="text-sm font-medium text-slate-600 ml-2">{t("areaTasks.dailyRequiredTasks")}</p>
        <Button 
          onClick={handleCompleteAll}
          disabled={completedCount === totalCount || completeAllMutation.isPending}
          className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-lg shadow-emerald-600/20 font-bold px-6"
        >
          {completeAllMutation.isPending ? t("areaTasks.updating") : t("areaTasks.completeAllRemaining")}
        </Button>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
        <ul className="divide-y divide-slate-100">
          {tasks?.map((task) => (
            <li 
              key={task.id} 
              className={`p-4 sm:p-5 transition-colors hover:bg-slate-50 flex items-start sm:items-center gap-4 ${task.completed ? 'bg-slate-50/50' : ''}`}
            >
              <button
                onClick={() => toggleTask(task)}
                disabled={completeMutation.isPending || uncompleteMutation.isPending}
                className={`
                  w-8 h-8 shrink-0 rounded-full border-2 flex items-center justify-center transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-accent/20
                  ${task.completed 
                    ? 'bg-emerald-500 border-emerald-500 text-white shadow-md shadow-emerald-500/30' 
                    : 'border-slate-300 bg-white hover:border-accent text-transparent hover:text-accent/20'
                  }
                `}
              >
                <Check className={`w-5 h-5 ${task.completed ? 'checkbox-anim' : ''}`} />
              </button>
              
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-base transition-colors ${task.completed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                  {task.taskName}
                </p>
                {task.isSpecial && (
                  <span className="inline-flex items-center gap-1 mt-1 text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                    <AlertCircle className="w-3 h-3" /> {t("areaTasks.specialInspectorRequest")}
                  </span>
                )}
                {task.notes && (
                  <p className="text-sm text-slate-500 mt-1 italic">"{task.notes}"</p>
                )}
              </div>

              <div className="shrink-0 text-right flex flex-col items-end gap-2">
                {task.completed ? (
                  <div className="flex flex-col items-end">
                    <span className="text-xs font-bold text-emerald-600 flex items-center gap-1 bg-emerald-50 px-2 py-1 rounded-md">
                      <Clock className="w-3 h-3" /> {task.completedAt ? format(new Date(task.completedAt), "h:mm a", { locale: dateLocale }) : t("common.done")}
                    </span>
                    {task.completedByName && (
                      <span className="text-[10px] font-medium text-slate-400 mt-1">
                        {t("common.by")} <StaffName name={task.completedByName} active={task.completedByActive} />
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">{t("common.pending")}</span>
                )}
                <TaskPhotoToggle
                  taskId={task.id}
                  beforeImagePath={(task as any).beforeImagePath ?? null}
                  afterImagePath={(task as any).afterImagePath ?? null}
                  compact
                />
              </div>
            </li>
          ))}
          {(!tasks || tasks.length === 0) && (
            <li className="p-8 text-center text-slate-500 font-medium">{t("areaTasks.noTasksFound")}</li>
          )}
        </ul>
      </div>

      {isAdmin && (
        <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/60">
            <h2 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
              <Settings className="w-5 h-5 text-slate-500" />
              Tasks for this area
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Toggle off any task that doesn't apply here. Excluded tasks won't appear on future daily sheets,
              and any not-yet-completed copies on today's sheet will be removed. Completed tasks stay for the
              audit trail.
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {(effectiveTasks ?? []).map((item) => {
              const isToggling = togglingTaskName === item.taskName;
              return (
                <li key={`${item.source}-${item.taskName}`} className="px-6 py-3 flex items-center gap-4">
                  <span className="text-xs font-bold text-slate-400 tabular-nums w-10">{item.taskOrder}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${item.excluded ? "text-slate-400 line-through" : "text-slate-800"}`}>
                      {item.taskName}
                    </p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    item.source === "global"
                      ? "bg-blue-50 text-blue-700 border border-blue-100"
                      : "bg-purple-50 text-purple-700 border border-purple-100"
                  }`}>
                    {item.source === "global" ? "Global" : "Area-specific"}
                  </span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    item.excluded
                      ? "bg-rose-50 text-rose-600 border border-rose-100"
                      : "bg-emerald-50 text-emerald-700 border border-emerald-100"
                  }`}>
                    {item.excluded ? "Excluded" : "Active"}
                  </span>
                  <button
                    onClick={() => handleToggleExclusion(item.taskName, item.excluded)}
                    disabled={isToggling}
                    title={item.excluded ? "Re-enable for this area" : "Mark as not applicable"}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors disabled:opacity-50"
                  >
                    {isToggling ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : item.excluded ? (
                      <ToggleLeft className="w-6 h-6" />
                    ) : (
                      <ToggleRight className="w-6 h-6 text-emerald-500" />
                    )}
                  </button>
                </li>
              );
            })}
            {effectiveTasks && effectiveTasks.length === 0 && (
              <li className="p-8 text-center text-slate-500 font-medium">No applicable tasks configured.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
