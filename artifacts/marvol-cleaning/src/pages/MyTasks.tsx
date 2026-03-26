import React, { useMemo } from "react";
import { format, getHours } from "date-fns";
import {
  useListTasks,
  useListAssignments,
  useCompleteTask,
  useUncompleteTask,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  CheckCircle2,
  Circle,
  Clock,
  MapPin,
  AlertCircle,
  PartyPopper,
  Star,
  User,
  ClipboardList,
  ChevronRight,
  Camera,
} from "lucide-react";
import { TaskPhotoToggle } from "@/components/TaskPhotos";

const TERMINAL_STYLES: Record<string, { bg: string; text: string; dot: string; bar: string; border: string }> = {
  "Terminal A": { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500", bar: "bg-blue-500", border: "border-blue-200" },
  "Terminal B": { bg: "bg-violet-50", text: "text-violet-700", dot: "bg-violet-500", bar: "bg-violet-500", border: "border-violet-200" },
  "Terminal C": { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", bar: "bg-emerald-500", border: "border-emerald-200" },
  "Top Terminal": { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500", bar: "bg-amber-500", border: "border-amber-200" },
};

function termStyle(terminal: string) {
  return TERMINAL_STYLES[terminal] ?? { bg: "bg-slate-50", text: "text-slate-700", dot: "bg-slate-500", bar: "bg-slate-500", border: "border-slate-200" };
}

function getGreeting(name: string) {
  const h = getHours(new Date());
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return `${part}, ${name.split(" ")[0]}`;
}

export default function MyTasks() {
  const { currentUser } = useAuth();
  const today = format(new Date(), "yyyy-MM-dd");
  const qc = useQueryClient();

  const { data: assignments, isLoading: loadingAssignments } = useListAssignments({
    date: today,
    staffId: currentUser?.id,
  });

  const { data: allTasks, isLoading: loadingTasks } = useListTasks({ date: today });

  const { data: extraTasks } = useListTasks({
    date: today,
    assignedToId: currentUser?.id,
  });

  const completeMutation = useCompleteTask({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/tasks"] }) },
  });
  const uncompleteMutation = useUncompleteTask({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/tasks"] }) },
  });

  const isLoading = loadingAssignments || loadingTasks;

  if (!currentUser) return null;

  const myAreaIds = (assignments ?? []).map((a) => a.areaId);

  const areaGroups = useMemo(() => {
    return myAreaIds.map((areaId) => {
      const assignment = assignments?.find((a) => a.areaId === areaId);
      const tasks = (allTasks ?? [])
        .filter((t) => t.areaId === areaId)
        .sort((a, b) => a.taskOrder - b.taskOrder);
      const completed = tasks.filter((t) => t.completed).length;
      return {
        areaId,
        areaName: assignment?.areaName ?? "Area",
        terminal: (assignment as any)?.terminal ?? "",
        assignedByName: (assignment as any)?.assignedByName ?? "",
        notes: assignment?.notes ?? "",
        tasks,
        completed,
        total: tasks.length,
        pct: tasks.length > 0 ? Math.round((tasks.filter((t) => t.completed).length / tasks.length) * 100) : 0,
      };
    });
  }, [myAreaIds, assignments, allTasks]);

  const myExtraTasks = useMemo(() => {
    const areaTaskIds = new Set(areaGroups.flatMap((g) => g.tasks.map((t) => t.id)));
    return (extraTasks ?? []).filter((t) => t.isSpecial && !areaTaskIds.has(t.id));
  }, [extraTasks, areaGroups]);

  const totalTasks = areaGroups.reduce((s, g) => s + g.total, 0) + myExtraTasks.length;
  const totalCompleted = areaGroups.reduce((s, g) => s + g.completed, 0) + myExtraTasks.filter((t) => t.completed).length;
  const allDone = totalTasks > 0 && totalCompleted === totalTasks;

  const toggleTask = (task: any) => {
    if (task.completed) {
      uncompleteMutation.mutate({ id: task.id });
    } else {
      completeMutation.mutate({ id: task.id, data: { completedById: currentUser.id } });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-2xl mx-auto">
        <div className="h-24 bg-slate-100 rounded-3xl animate-pulse" />
        <div className="h-64 bg-slate-100 rounded-3xl animate-pulse" />
        <div className="h-64 bg-slate-100 rounded-3xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto pb-16">

      {/* === Shift Header === */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl p-6 text-white shadow-xl shadow-slate-900/20">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-slate-400 text-sm font-medium uppercase tracking-wider mb-1">Your Shift</p>
            <h1 className="text-2xl font-bold">{getGreeting(currentUser.name)}</h1>
            <p className="text-slate-400 text-sm mt-1.5 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {format(new Date(), "EEEE, MMMM d, yyyy")}
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-3xl font-bold tabular-nums">{totalCompleted}<span className="text-slate-500 text-lg">/{totalTasks}</span></div>
            <p className="text-slate-400 text-xs mt-0.5">tasks done</p>
          </div>
        </div>

        {totalTasks > 0 && (
          <div className="mt-5">
            <div className="flex justify-between text-xs font-medium mb-2">
              <span className="text-slate-400">Overall progress</span>
              <span className={allDone ? "text-emerald-400" : "text-white"}>
                {Math.round((totalCompleted / totalTasks) * 100)}%
              </span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${allDone ? "bg-emerald-400" : "bg-blue-400"}`}
                style={{ width: `${Math.round((totalCompleted / totalTasks) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* === All Done Celebration === */}
      {allDone && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-3xl px-6 py-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500 flex items-center justify-center shrink-0">
            <PartyPopper className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="font-bold text-emerald-800 text-lg">All tasks complete!</p>
            <p className="text-emerald-600 text-sm">Great work today. Let your supervisor know you're finished.</p>
          </div>
        </div>
      )}

      {/* === No Assignment State === */}
      {myAreaIds.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-20 h-20 rounded-3xl bg-slate-100 flex items-center justify-center mb-5">
            <AlertCircle className="w-9 h-9 text-slate-400" />
          </div>
          <h2 className="text-xl font-bold text-slate-700 mb-2">No Area Assignment Yet</h2>
          <p className="text-slate-500 text-sm max-w-xs leading-relaxed">
            You haven't been assigned to an area for {format(new Date(), "MMMM d")} yet. Check with your supervisor to get your assignment.
          </p>
        </div>
      )}

      {/* === Area Assignments === */}
      {areaGroups.map(({ areaId, areaName, terminal, assignedByName, notes, tasks, completed, total, pct }) => {
        const style = termStyle(terminal);
        const done = completed === total && total > 0;

        return (
          <div key={areaId} className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">

            {/* Area header */}
            <div className={`px-5 py-4 ${done ? "bg-emerald-50 border-b border-emerald-100" : `${style.bg} border-b ${style.border}`}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 mt-0.5 ${done ? "bg-emerald-500" : style.dot.replace("bg-", "bg-")}`}>
                    <MapPin className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    {terminal && (
                      <span className={`text-xs font-bold uppercase tracking-wider ${done ? "text-emerald-600" : style.text}`}>
                        {terminal}
                      </span>
                    )}
                    <h2 className="font-bold text-slate-900 text-base leading-tight">{areaName}</h2>
                    {assignedByName && (
                      <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                        <User className="w-3 h-3" />
                        Assigned by {assignedByName}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {done ? (
                    <div className="flex items-center gap-1.5 text-emerald-600 text-sm font-bold">
                      <CheckCircle2 className="w-4 h-4" /> Done
                    </div>
                  ) : (
                    <div>
                      <span className="text-2xl font-bold text-slate-800 tabular-nums">{completed}</span>
                      <span className="text-slate-400 text-sm">/{total}</span>
                    </div>
                  )}
                </div>
              </div>

              {notes && (
                <div className="mt-3 bg-white/60 rounded-xl px-3 py-2 text-xs text-slate-600 border border-white/80">
                  <span className="font-semibold text-slate-700">Note: </span>{notes}
                </div>
              )}

              {/* Progress bar */}
              <div className="mt-3 h-1.5 bg-white/50 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${done ? "bg-emerald-500" : style.bar}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* Task checklist */}
            <div className="divide-y divide-slate-50">
              {tasks.map((task, idx) => (
                <div key={task.id}>
                  <button
                    onClick={() => toggleTask(task)}
                    className={`w-full flex items-start gap-4 px-5 py-4 text-left transition-colors active:bg-slate-50 ${
                      task.completed ? "bg-slate-50/50" : "hover:bg-slate-50/60"
                    }`}
                  >
                    <div className={`mt-0.5 shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                      task.completed
                        ? "text-emerald-500"
                        : "text-slate-300 hover:text-blue-400"
                    }`}>
                      {task.completed
                        ? <CheckCircle2 className="w-6 h-6" />
                        : <Circle className="w-6 h-6" />
                      }
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium leading-snug ${
                        task.completed ? "line-through text-slate-400" : "text-slate-800"
                      }`}>
                        {task.taskName}
                      </p>
                      {task.completed && task.completedAt && (
                        <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Done at {format(new Date(task.completedAt), "h:mm a")}
                          {task.completedByName && ` · ${task.completedByName}`}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <span className={`text-xs font-bold tabular-nums pt-0.5 ${
                        task.completed ? "text-slate-300" : "text-slate-400"
                      }`}>
                        #{task.taskOrder}
                      </span>
                    </div>
                  </button>
                  <div className="px-5 pb-2 -mt-1">
                    <TaskPhotoToggle
                      taskId={task.id}
                      beforeImagePath={(task as any).beforeImagePath ?? null}
                      afterImagePath={(task as any).afterImagePath ?? null}
                      compact
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* === Extra Tasks from Supervisor === */}
      {myExtraTasks.length > 0 && (
        <div className="bg-white rounded-3xl border border-amber-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 bg-amber-50 border-b border-amber-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500 flex items-center justify-center shrink-0">
              <Star className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900">Extra Tasks from Supervisor</h2>
              <p className="text-xs text-amber-700 font-medium">
                {myExtraTasks.filter((t) => t.completed).length}/{myExtraTasks.length} completed
              </p>
            </div>
          </div>
          <div className="divide-y divide-slate-50">
            {myExtraTasks.map((task) => (
              <div key={task.id}>
                <button
                  onClick={() => toggleTask(task)}
                  className={`w-full flex items-start gap-4 px-5 py-4 text-left transition-colors ${
                    task.completed ? "bg-slate-50/50" : "hover:bg-amber-50/30"
                  }`}
                >
                  <div className={`mt-0.5 shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                    task.completed ? "text-emerald-500" : "text-amber-400"
                  }`}>
                    {task.completed ? <CheckCircle2 className="w-6 h-6" /> : <Circle className="w-6 h-6" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium leading-snug ${task.completed ? "line-through text-slate-400" : "text-slate-800"}`}>
                      {task.taskName}
                    </p>
                    {task.notes && (
                      <p className="text-xs text-slate-500 mt-0.5">{task.notes}</p>
                    )}
                    {task.completed && task.completedAt && (
                      <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Done at {format(new Date(task.completedAt), "h:mm a")}
                      </p>
                    )}
                  </div>
                </button>
                <div className="px-5 pb-2 -mt-1">
                  <TaskPhotoToggle
                    taskId={task.id}
                    beforeImagePath={(task as any).beforeImagePath ?? null}
                    afterImagePath={(task as any).afterImagePath ?? null}
                    compact
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === Footer hint === */}
      {myAreaIds.length > 0 && !allDone && (
        <div className="text-center text-xs text-slate-400 pb-4">
          <ClipboardList className="w-4 h-4 inline mr-1 opacity-50" />
          Tap any task to mark it complete. Changes save instantly.
        </div>
      )}
    </div>
  );
}
