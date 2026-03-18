import React, { useState } from "react";
import { format } from "date-fns";
import { useListTasks, useListAssignments, useCompleteTask, useUncompleteTask, useCompleteAllTasks } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { CheckCircle2, Circle, Clock, CheckCheck, MapPin, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function MyTasks() {
  const { currentUser } = useAuth();
  const today = format(new Date(), "yyyy-MM-dd");
  const queryClient = useQueryClient();

  const { data: assignments } = useListAssignments({ date: today, staffId: currentUser?.id });
  const { data: allTasks, isLoading } = useListTasks({ date: today });

  const completeMutation = useCompleteTask({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }) }
  });
  const uncompleteMutation = useUncompleteTask({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }) }
  });
  const completeAllMutation = useCompleteAllTasks({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }) }
  });

  if (!currentUser) return null;

  const myAreaIds = (assignments ?? []).map((a) => a.areaId);

  const tasksByArea = myAreaIds.map((areaId) => {
    const assignment = assignments?.find((a) => a.areaId === areaId);
    const tasks = (allTasks ?? []).filter((t) => t.areaId === areaId);
    const completed = tasks.filter((t) => t.completed).length;
    return { areaId, areaName: assignment?.areaName ?? "Area", tasks, completed };
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="h-48 bg-slate-100 rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (tasksByArea.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8 text-slate-400" />
        </div>
        <h2 className="text-xl font-semibold text-slate-700 mb-2">No Assignments Today</h2>
        <p className="text-slate-500 text-sm max-w-sm">
          You haven't been assigned to any areas for {format(new Date(), "MMMM d, yyyy")}. Check with your supervisor.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      <div>
        <h1 className="text-3xl font-bold text-foreground">My Tasks</h1>
        <p className="text-slate-500 mt-1 flex items-center gap-2">
          <Clock className="w-4 h-4" />
          {format(new Date(), "EEEE, MMMM d, yyyy")} · {currentUser.name}
        </p>
      </div>

      {tasksByArea.map(({ areaId, areaName, tasks, completed }) => {
        const pct = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;
        const allDone = completed === tasks.length && tasks.length > 0;

        return (
          <div key={areaId} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            {/* Area header */}
            <div className={`px-6 py-4 border-b flex items-center justify-between ${allDone ? "bg-emerald-50 border-emerald-100" : "bg-slate-50 border-slate-100"}`}>
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${allDone ? "bg-emerald-500" : "bg-blue-600"}`}>
                  <MapPin className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-800">{areaName}</h2>
                  <p className={`text-xs font-medium ${allDone ? "text-emerald-600" : "text-slate-500"}`}>
                    {completed}/{tasks.length} tasks · {pct}%
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {!allDone && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    onClick={() =>
                      completeAllMutation.mutate({
                        data: { areaId, date: today, completedById: currentUser.id },
                      })
                    }
                  >
                    <CheckCheck className="w-3.5 h-3.5 mr-1" />
                    Complete All
                  </Button>
                )}
                {allDone && (
                  <span className="flex items-center gap-1 text-emerald-600 text-sm font-medium">
                    <CheckCircle2 className="w-4 h-4" /> Done
                  </span>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-1 bg-slate-100">
              <div
                className={`h-full transition-all duration-500 ${allDone ? "bg-emerald-500" : "bg-blue-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>

            {/* Tasks */}
            <div className="divide-y divide-slate-50">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className={`flex items-start gap-4 px-6 py-3.5 hover:bg-slate-50/60 transition-colors ${task.completed ? "opacity-70" : ""}`}
                >
                  <button
                    onClick={() => {
                      if (task.completed) {
                        uncompleteMutation.mutate({ id: task.id });
                      } else {
                        completeMutation.mutate({ id: task.id, data: { completedById: currentUser.id } });
                      }
                    }}
                    className="mt-0.5 shrink-0 text-slate-400 hover:text-blue-500 transition-colors"
                  >
                    {task.completed
                      ? <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      : <Circle className="w-5 h-5" />
                    }
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${task.completed ? "line-through text-slate-400" : "text-slate-700"}`}>
                      {task.taskName}
                    </p>
                    {task.completed && task.completedAt && (
                      <p className="text-xs text-emerald-600 mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Completed {format(new Date(task.completedAt), "h:mm a")}
                        {task.completedByName && ` · ${task.completedByName}`}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-slate-400 shrink-0 pt-0.5">#{task.taskOrder}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
