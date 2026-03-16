import React, { useState } from "react";
import { useRoute } from "wouter";
import { format } from "date-fns";
import { 
  useListTasks, 
  useCompleteTask, 
  useUncompleteTask, 
  useCompleteAllTasks,
  useListAreas
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Clock, User, AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { StatusBadge } from "@/components/ui/StatusBadge";

export default function AreaTasks() {
  const [, params] = useRoute("/areas/:areaId");
  const areaId = params?.areaId ? parseInt(params.areaId) : 0;
  const [selectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const queryClient = useQueryClient();

  const { data: areas } = useListAreas();
  const areaInfo = areas?.find(a => a.id === areaId);

  const { data: tasks, isLoading } = useListTasks({ areaId, date: selectedDate }, { 
    query: { enabled: !!areaId } 
  });

  // MOCK USER ID FOR DEMO (In real app, get from auth context)
  const currentUserId = 1; 

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
    return <div className="p-8 text-center text-slate-500 font-medium animate-pulse">Loading task sheet...</div>;
  }

  const completedCount = tasks?.filter(t => t.completed).length || 0;
  const totalCount = tasks?.length || 0;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <Link href="/areas" className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-accent transition-colors">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Area List
      </Link>

      {/* Header Area */}
      <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <StatusBadge status="info">{areaInfo?.terminal || 'Terminal'}</StatusBadge>
              <span className="text-sm font-semibold text-slate-400 uppercase tracking-wider">{format(new Date(selectedDate), "MMM do, yyyy")}</span>
            </div>
            <h1 className="text-4xl font-display font-bold text-slate-900">{areaInfo?.name || `Area ${areaId}`}</h1>
            <p className="text-slate-500 mt-2 font-medium flex items-center gap-2">
              <User className="w-4 h-4" /> 
              Assigned: <span className="text-slate-800">
                {tasks?.[0]?.assignedToName || 'No specific assignment'}
              </span>
            </p>
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 min-w-[200px]">
            <div className="flex justify-between items-end mb-2">
              <span className="text-sm font-bold text-slate-500 uppercase tracking-wider">Progress</span>
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

      {/* Actions */}
      <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <p className="text-sm font-medium text-slate-600 ml-2">Daily Required Tasks (15)</p>
        <Button 
          onClick={handleCompleteAll}
          disabled={completedCount === totalCount || completeAllMutation.isPending}
          className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-lg shadow-emerald-600/20 font-bold px-6"
        >
          {completeAllMutation.isPending ? "Updating..." : "Complete All Remaining"}
        </Button>
      </div>

      {/* Task List */}
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
                    <AlertCircle className="w-3 h-3" /> Special Inspector Request
                  </span>
                )}
                {task.notes && (
                  <p className="text-sm text-slate-500 mt-1 italic">"{task.notes}"</p>
                )}
              </div>

              <div className="shrink-0 text-right">
                {task.completed ? (
                  <div className="flex flex-col items-end">
                    <span className="text-xs font-bold text-emerald-600 flex items-center gap-1 bg-emerald-50 px-2 py-1 rounded-md">
                      <Clock className="w-3 h-3" /> {task.completedAt ? format(new Date(task.completedAt), "h:mm a") : 'Done'}
                    </span>
                    {task.completedByName && (
                      <span className="text-[10px] font-medium text-slate-400 mt-1">by {task.completedByName}</span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Pending</span>
                )}
              </div>
            </li>
          ))}
          {(!tasks || tasks.length === 0) && (
            <li className="p-8 text-center text-slate-500 font-medium">No tasks found for this area today.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
