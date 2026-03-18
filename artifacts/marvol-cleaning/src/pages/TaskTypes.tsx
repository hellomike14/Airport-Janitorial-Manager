import React, { useState } from "react";
import {
  useListTaskTypes,
  useCreateTaskType,
  useUpdateTaskType,
  useDeleteTaskType,
  useReorderTaskTypes,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ClipboardList,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  GripVertical,
  ToggleLeft,
  ToggleRight,
  Loader2,
  ListChecks,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function TaskTypes() {
  const qc = useQueryClient();
  const { data: taskTypes = [], isLoading } = useListTaskTypes();
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/task-types"] });

  const createMutation = useCreateTaskType({
    mutation: { onSuccess: () => { invalidate(); setIsAdding(false); setNewName(""); } },
  });
  const updateMutation = useUpdateTaskType({
    mutation: { onSuccess: () => { invalidate(); setEditingId(null); setEditName(""); } },
  });
  const deleteMutation = useDeleteTaskType({
    mutation: { onSuccess: () => { invalidate(); setDeletingId(null); } },
  });
  const reorderMutation = useReorderTaskTypes({
    mutation: { onSuccess: invalidate },
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    createMutation.mutate({ data: { taskName: newName.trim() } });
  };

  const handleStartEdit = (id: number, name: string) => {
    setEditingId(id);
    setEditName(name);
  };

  const handleSaveEdit = (id: number) => {
    if (!editName.trim()) return;
    updateMutation.mutate({ id, data: { taskName: editName.trim() } });
  };

  const handleToggleActive = (id: number, active: boolean) => {
    updateMutation.mutate({ id, data: { active: !active } });
  };

  const handleDelete = (id: number) => {
    setDeletingId(id);
  };

  const confirmDelete = (id: number) => {
    deleteMutation.mutate({ id });
  };

  const handleDragStart = (id: number) => setDragId(id);
  const handleDragOver = (e: React.DragEvent, id: number) => {
    e.preventDefault();
    setDragOverId(id);
  };
  const handleDrop = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }

    const sorted = [...taskTypes].sort((a, b) => a.taskOrder - b.taskOrder);
    const fromIdx = sorted.findIndex((t) => t.id === dragId);
    const toIdx = sorted.findIndex((t) => t.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = [...sorted];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    reorderMutation.mutate({ data: { orderedIds: reordered.map((t) => t.id) } });
    setDragId(null);
    setDragOverId(null);
  };
  const handleDragEnd = () => { setDragId(null); setDragOverId(null); };

  const sorted = [...taskTypes].sort((a, b) => a.taskOrder - b.taskOrder);
  const activeCount = sorted.filter((t) => t.active).length;

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900 flex items-center gap-3">
            <ListChecks className="w-8 h-8 text-blue-600" />
            Task Type Inventory
          </h1>
          <p className="text-slate-500 mt-1 font-medium">
            Manage the daily task templates applied to every cleaning area.
          </p>
        </div>
        <Button
          onClick={() => { setIsAdding(true); setNewName(""); }}
          className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl shadow-md shadow-emerald-700/20 font-bold"
        >
          <Plus className="w-4 h-4 mr-2" /> Add Task Type
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Total Types</p>
          <p className="text-3xl font-bold text-slate-900">{sorted.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-emerald-200 p-5 shadow-sm">
          <p className="text-xs font-semibold text-emerald-500 uppercase tracking-wider mb-1">Active</p>
          <p className="text-3xl font-bold text-emerald-700">{activeCount}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Inactive</p>
          <p className="text-3xl font-bold text-slate-500">{sorted.length - activeCount}</p>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-2xl px-5 py-4 text-sm text-blue-800">
        <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
        <div>
          <strong className="font-semibold">About task types:</strong> These templates define the daily checklist for every cleaning area. Changes take effect for <em>new days</em> — tasks already created for today are not affected. Drag rows to reorder. Toggle active/inactive to include or exclude from daily generation.
        </div>
      </div>

      {/* Add form */}
      {isAdding && (
        <div className="bg-blue-50 rounded-2xl border border-blue-100 p-5">
          <h3 className="text-sm font-bold text-blue-900 mb-3 flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Task Type
          </h3>
          <form onSubmit={handleAdd} className="flex gap-3">
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Clean and sanitize restrooms"
              className="flex-1 bg-white border border-blue-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
            />
            <Button
              type="submit"
              disabled={createMutation.isPending || !newName.trim()}
              className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold px-5"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setIsAdding(false); setNewName(""); }}
              className="rounded-xl text-slate-500 hover:bg-blue-100"
            >
              <X className="w-4 h-4" />
            </Button>
          </form>
        </div>
      )}

      {/* Task list */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400 animate-pulse">Loading task types...</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {/* Header */}
            <div className="grid grid-cols-[32px_40px_1fr_120px_80px] gap-3 px-5 py-3 bg-slate-50 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              <div />
              <div>#</div>
              <div>Task Name</div>
              <div className="text-center">Status</div>
              <div className="text-right">Actions</div>
            </div>

            {sorted.map((task) => {
              const isDragging = dragId === task.id;
              const isDragTarget = dragOverId === task.id;
              const isEditing = editingId === task.id;
              const isDeleting = deletingId === task.id;

              return (
                <div
                  key={task.id}
                  draggable
                  onDragStart={() => handleDragStart(task.id)}
                  onDragOver={(e) => handleDragOver(e, task.id)}
                  onDrop={(e) => handleDrop(e, task.id)}
                  onDragEnd={handleDragEnd}
                  className={`grid grid-cols-[32px_40px_1fr_120px_80px] gap-3 px-5 py-3.5 items-center transition-all ${
                    isDragging ? "opacity-40 bg-blue-50" : ""
                  } ${isDragTarget && !isDragging ? "border-t-2 border-blue-400 bg-blue-50/30" : ""} ${
                    !task.active ? "bg-slate-50/60" : ""
                  } hover:bg-slate-50/80`}
                >
                  {/* Drag handle */}
                  <div className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-400">
                    <GripVertical className="w-4 h-4" />
                  </div>

                  {/* Order */}
                  <div className="text-sm font-bold text-slate-400 tabular-nums">{task.taskOrder}</div>

                  {/* Name */}
                  <div className="min-w-0">
                    {isEditing ? (
                      <div className="flex gap-2 items-center">
                        <input
                          autoFocus
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveEdit(task.id);
                            if (e.key === "Escape") { setEditingId(null); setEditName(""); }
                          }}
                          className="flex-1 border border-blue-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                        />
                        <button
                          onClick={() => handleSaveEdit(task.id)}
                          disabled={updateMutation.isPending}
                          className="p-1.5 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                        >
                          {updateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => { setEditingId(null); setEditName(""); }}
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : isDeleting ? (
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-rose-700 font-medium">Delete "{task.taskName.slice(0, 40)}…"?</span>
                        <button
                          onClick={() => confirmDelete(task.id)}
                          disabled={deleteMutation.isPending}
                          className="px-3 py-1 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 text-xs font-bold transition-colors"
                        >
                          {deleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : "Yes, Delete"}
                        </button>
                        <button
                          onClick={() => setDeletingId(null)}
                          className="px-3 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-medium transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <span className={`text-sm ${task.active ? "text-slate-800 font-medium" : "text-slate-400 line-through"}`}>
                        {task.taskName}
                      </span>
                    )}
                  </div>

                  {/* Status badge */}
                  <div className="flex justify-center">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                      task.active
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    }`}>
                      {task.active ? "Active" : "Inactive"}
                    </span>
                  </div>

                  {/* Actions */}
                  {!isEditing && !isDeleting && (
                    <div className="flex justify-end items-center gap-1">
                      <button
                        onClick={() => handleToggleActive(task.id, task.active)}
                        title={task.active ? "Deactivate" : "Activate"}
                        className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
                      >
                        {task.active
                          ? <ToggleRight className="w-4 h-4 text-emerald-500" />
                          : <ToggleLeft className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => handleStartEdit(task.id, task.taskName)}
                        className="p-1.5 rounded-lg text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(task.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {sorted.length === 0 && !isLoading && (
              <div className="p-12 text-center text-slate-400">
                <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No task types yet</p>
                <p className="text-sm mt-1">Add your first task type using the button above.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
