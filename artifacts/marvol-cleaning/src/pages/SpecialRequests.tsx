import React, { useState, useMemo } from "react";
import { format } from "date-fns";
import {
  useListAreas,
  useListTasks,
} from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SpecialRequests() {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const [selectedDate, setSelectedDate] = useState(today);
  const [isCreating, setIsCreating] = useState(false);

  const { data: areas } = useListAreas();
  const { data: tasks } = useListTasks({ date: selectedDate });

  const [formData, setFormData] = useState({
    areaId: "",
    notes: "",
  });

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
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

  const areaMap = useMemo(() => {
    const m = new Map<number, string>();
    (areas ?? []).forEach((a) => m.set(a.id, a.name));
    return m;
  }, [areas]);

  const specialTasks = (tasks ?? []).filter((t: any) => t.isSpecial);
  const pendingSpecial = specialTasks.filter((t: any) => !t.completed);
  const completedSpecial = specialTasks.filter((t: any) => t.completed);

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900 flex items-center gap-3">
            <Star className="w-8 h-8 text-amber-500" />
            Special Requests
          </h1>
          <p className="text-slate-500 mt-1 font-medium">
            Create special cleaning or inspection requests for any area.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
            <Clock className="w-4 h-4 text-blue-500" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-sm font-semibold text-slate-700 bg-transparent outline-none cursor-pointer"
            />
          </div>
          <Button
            onClick={() => setIsCreating(!isCreating)}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md shadow-blue-600/20 font-bold"
          >
            <Plus className="w-4 h-4 mr-2" /> New Request
          </Button>
        </div>
      </div>

      {isCreating && (
        <div className="bg-blue-50 rounded-3xl p-6 border border-blue-100 shadow-sm animate-fade-in-up">
          <h3 className="text-lg font-bold text-blue-900 mb-4 flex items-center gap-2">
            <Star className="w-5 h-5 text-amber-500" /> New Special Request
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-blue-900 mb-1">
                Target Area
              </label>
              <select
                required
                value={formData.areaId}
                onChange={(e) =>
                  setFormData({ ...formData, areaId: e.target.value })
                }
                className="w-full bg-white border border-blue-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="">-- Choose Area --</option>
                {areas?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-blue-900 mb-1">
                Request Details
              </label>
              <textarea
                required
                rows={3}
                value={formData.notes}
                onChange={(e) =>
                  setFormData({ ...formData, notes: e.target.value })
                }
                placeholder="Describe the special request — e.g. Deep clean elevator lobby on level 3, check stairwell lighting on level 5..."
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
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md shadow-blue-600/20 px-6 font-bold"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />{" "}
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" /> Submit Request
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Total Requests
          </p>
          <p className="text-3xl font-bold text-slate-800 mt-1">
            {specialTasks.length}
          </p>
        </div>
        <div className="bg-amber-50 rounded-2xl border border-amber-200 px-5 py-4 shadow-sm">
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">
            Pending
          </p>
          <p className="text-3xl font-bold text-amber-700 mt-1">
            {pendingSpecial.length}
          </p>
        </div>
        <div className="bg-emerald-50 rounded-2xl border border-emerald-200 px-5 py-4 shadow-sm">
          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">
            Completed
          </p>
          <p className="text-3xl font-bold text-emerald-700 mt-1">
            {completedSpecial.length}
          </p>
        </div>
      </div>

      {/* Pending requests */}
      {pendingSpecial.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-slate-800 mb-3 flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-500" /> Pending Requests
          </h2>
          <div className="space-y-3">
            {pendingSpecial.map((task: any) => (
              <RequestCard key={task.id} task={task} areaMap={areaMap} />
            ))}
          </div>
        </div>
      )}

      {/* Completed requests */}
      {completedSpecial.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-slate-800 mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" /> Completed
            Requests
          </h2>
          <div className="space-y-3">
            {completedSpecial.map((task: any) => (
              <RequestCard key={task.id} task={task} areaMap={areaMap} />
            ))}
          </div>
        </div>
      )}

      {specialTasks.length === 0 && !isCreating && (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white rounded-3xl border border-slate-200 border-dashed">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
            <ClipboardList className="w-8 h-8 text-blue-400" />
          </div>
          <h3 className="text-lg font-bold text-slate-700">
            No Special Requests Yet
          </h3>
          <p className="text-slate-500 text-sm mt-1 max-w-xs">
            Use the "New Request" button to create a special cleaning or
            inspection request for any area.
          </p>
        </div>
      )}
    </div>
  );
}

function RequestCard({ task, areaMap }: { task: any; areaMap: Map<number, string> }) {
  const area = areaMap.get(task.areaId) ?? "Unknown Area";

  return (
    <div
      className={`rounded-2xl border p-5 transition-all ${
        task.completed
          ? "bg-slate-50 border-slate-200 opacity-80"
          : "bg-white border-amber-200 shadow-sm"
      }`}
    >
      <div className="flex items-start gap-4">
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
              <MapPin className="w-3 h-3" /> {area}
            </span>
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                task.completed
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {task.completed ? "Done" : "Pending"}
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
            {task.completed && task.completedAt && (
              <span className="flex items-center gap-1 text-emerald-600">
                <Clock className="w-3 h-3" />
                Done at {format(new Date(task.completedAt), "h:mm a")}
              </span>
            )}
            {task.completedByName && (
              <span className="text-slate-500">
                By {task.completedByName}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
