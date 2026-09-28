import React, { useState } from "react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { getDateLocale } from "@/i18n/dateLocale";
import { 
  useListAssignments, 
  useAssignTerminalGroup,
  useDeleteAssignment,
  useListStaff
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Calendar, Trash2, Plus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";

const terminalGroups = [
  ["terminal-a-east", "terminalAEast"],
  ["terminal-a-west", "terminalAWest"],
  ["terminal-b-east", "terminalBEast"],
  ["terminal-b-west", "terminalBWest"],
  ["terminal-c-135", "terminalC135"],
  ["terminal-c-246", "terminalC246"],
  ["top-terminal", "topTerminal"],
] as const;

function assignmentGroup(terminal: string, areaName: string): string {
  const directGroup: Record<string, string> = {
    "Terminal A - East": "terminal-a-east",
    "Terminal A - West": "terminal-a-west",
    "Terminal B - East": "terminal-b-east",
    "Terminal B - West": "terminal-b-west",
    "Top Terminal": "top-terminal",
  };
  if (directGroup[terminal]) return directGroup[terminal];
  if (terminal === "Terminal C") {
    if (/^(Group 1|Terminal C - Levels 1|Level [135]\b)/.test(areaName)) return "terminal-c-135";
    if (/^(Group 2|Terminal C - Levels 2|Level [246]\b)/.test(areaName)) return "terminal-c-246";
  }
  return terminal || "—";
}

export default function Assignments() {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateLocale(i18n.language);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: assignments, isLoading } = useListAssignments({ date: selectedDate });
  const { data: staff } = useListStaff();

  const [formData, setFormData] = useState({
    staffId: '', groupKey: '', notes: '', isSpecial: false
  });

  const createMutation = useAssignTerminalGroup({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/assignments"] });
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
        setIsAdding(false);
        setFormData({ staffId: '', groupKey: '', notes: '', isSpecial: false });
        setCreateError(null);
      },
      onError: (error) => setCreateError(error?.status === 409
        ? t("assignments.groupConflict")
        : t("assignments.createFailed")),
    }
  });

  const deleteMutation = useDeleteAssignment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/assignments"] });
        setDeleteError(null);
      },
      onError: () => setDeleteError(t("assignments.deleteFailed")),
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    if (!formData.staffId || !formData.groupKey) {
      setCreateError(t("assignments.chooseStaffAndGroup"));
      return;
    }
    createMutation.mutate({
      data: {
        staffId: Number(formData.staffId),
        groupKey: formData.groupKey as (typeof terminalGroups)[number][0],
        assignmentDate: selectedDate,
        notes: formData.notes,
        isSpecial: formData.isSpecial
      }
    });
  };

  const assignmentStaff = staff ?? [];
  const eligibleStaff = assignmentStaff.filter((person) => {
    return person.active && person.formerEmployee !== true;
  });

  const updateForm = (changes: Partial<typeof formData>) => {
    setCreateError(null);
    setFormData((current) => ({ ...current, ...changes }));
  };

  const removeAssignment = (id: number) => {
    if (confirm(t("assignments.removeAssignment"))) {
      setDeleteError(null);
      deleteMutation.mutate({ id });
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900">{t("assignments.shiftAssignments")}</h1>
          <p className="text-slate-500 mt-1 font-medium">{t("assignments.subtitle")}</p>
        </div>
        
        <div className="flex items-center gap-3 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 pl-2">
            <Calendar className="w-5 h-5 text-accent" />
            <input 
              type="date" 
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setCreateError(null);
                setDeleteError(null);
              }}
              className="font-bold text-slate-700 bg-transparent outline-none cursor-pointer"
            />
          </div>
          <div className="h-8 w-px bg-slate-200 mx-2" />
          <Button 
            onClick={() => {
              setIsAdding(!isAdding);
              setCreateError(null);
            }}
            className="bg-slate-900 hover:bg-slate-800 text-white rounded-xl"
          >
            <Plus className="w-4 h-4 mr-2" /> {t("assignments.assignStaff")}
          </Button>
        </div>
      </div>

      {isAdding && (
        <div className="bg-indigo-50/50 rounded-3xl p-6 border border-indigo-100 shadow-sm animate-fade-in-up">
          <h3 className="text-lg font-bold text-indigo-900 mb-4">{t("assignments.createAssignment", { date: format(new Date(selectedDate), "MMM do", { locale: dateLocale }) })}</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            {createError && (
              <div
                role="alert"
                data-testid="error-create-assignment"
                className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{createError}</span>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-indigo-900 mb-1">{t("assignments.selectStaff")}</label>
                <select required value={formData.staffId} onChange={e => updateForm({ staffId: e.target.value })} className="w-full bg-white border border-indigo-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                  <option value="">{t("assignments.chooseStaffMember")}</option>
                  {eligibleStaff.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <p className="mt-2 text-xs leading-relaxed text-indigo-700">
                  {t("assignments.activeStaffHint")}
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-indigo-900 mb-1" htmlFor="assignment-group">{t("assignments.selectGroup")}</label>
                <select id="assignment-group" required value={formData.groupKey} onChange={e => updateForm({ groupKey: e.target.value })} className="w-full bg-white border border-indigo-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                  <option value="">{t("assignments.chooseGroup")}</option>
                  {terminalGroups.map(([key, label]) => (
                    <option key={key} value={key}>{t(`assignments.groups.${label}`)}</option>
                  ))}
                </select>
                <p className="mt-2 text-xs leading-relaxed text-indigo-700">{t("assignments.groupHint")}</p>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-indigo-900 mb-1">{t("assignments.specialInstructions")}</label>
              <input value={formData.notes} onChange={e => updateForm({ notes: e.target.value })} placeholder={t("assignments.specialInstructionsPlaceholder")} className="w-full bg-white border border-indigo-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-indigo-800 bg-white px-4 py-2 rounded-xl border border-indigo-200">
                <input type="checkbox" checked={formData.isSpecial} onChange={e => updateForm({ isSpecial: e.target.checked })} className="w-4 h-4 text-indigo-600 rounded" />
                <Star className="w-4 h-4 text-amber-500" />
                {t("assignments.markSpecial")}
              </label>
              
              <div className="sm:flex-1" />
              <div className="flex gap-3 justify-end">
                <Button type="button" variant="ghost" onClick={() => {
                  setIsAdding(false);
                  setCreateError(null);
                }} className="rounded-xl text-indigo-700 hover:bg-indigo-100">{t("common.cancel")}</Button>
                <Button type="submit" disabled={createMutation.isPending} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md shadow-indigo-600/20 px-6 font-bold">
                  {createMutation.isPending ? t("assignments.assigning") : t("assignments.confirmAssignment")}
                </Button>
              </div>
            </div>
          </form>
        </div>
      )}

      {deleteError && (
        <div
          role="alert"
          data-testid="error-delete-assignment"
          className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{deleteError}</span>
        </div>
      )}

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500 animate-pulse">{t("assignments.loadingAssignments")}</div>
        ) : (!assignments || assignments.length === 0) ? (
          <div className="px-6 py-12 text-center text-slate-500 font-medium">
            {t("assignments.noAssignments", { date: format(new Date(selectedDate), "MMM do", { locale: dateLocale }) })}
          </div>
        ) : (
          (() => {
            // Keep the two Terminal C groups separate when showing saved areas.
            const groupedByGroup = assignments.reduce<
              Record<string, typeof assignments>
            >((acc, a) => {
              const key = assignmentGroup(a.terminal, a.areaName);
              if (!acc[key]) acc[key] = [];
              acc[key].push(a);
              return acc;
            }, {});
            const groupOrder = Object.keys(groupedByGroup).sort((a, b) => {
              const aIndex = terminalGroups.findIndex(([key]) => key === a);
              const bIndex = terminalGroups.findIndex(([key]) => key === b);
              return (aIndex < 0 ? 99 : aIndex) - (bIndex < 0 ? 99 : bIndex) || a.localeCompare(b);
            });
            return (
              <div className="divide-y divide-slate-100">
                {groupOrder.map((group) => {
                  const rows = groupedByGroup[group];
                  const label = terminalGroups.find(([key]) => key === group)?.[1];
                  return (
                    <section key={group} className="p-0">
                      <header className="px-6 py-3 bg-slate-50 border-b border-slate-200">
                        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                          {label ? t(`assignments.groups.${label}`) : group}
                        </h2>
                      </header>

                      <div className="sm:hidden divide-y divide-slate-100">
                        {rows.map((assignment) => (
                          <div key={assignment.id} className="p-4 flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-slate-800 text-sm">{assignment.staffName}</p>
                              <p className="text-sm text-slate-600 mt-0.5 font-medium">{assignment.areaName}</p>
                              <p className="text-xs text-slate-400 mt-0.5">{t("assignments.assignedByCol")}: {assignment.assignedByName}</p>
                              {(assignment.notes || assignment.isSpecial) && (
                                <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                                  {assignment.isSpecial && <Star className="w-3 h-3 text-amber-500 shrink-0" />}
                                  {assignment.notes || ''}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => removeAssignment(assignment.id)}
                              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 active:bg-rose-100 rounded-lg transition-colors touch-manipulation"
                              title={t("assignments.removeAssignmentTitle")}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>

                      <table className="hidden sm:table w-full text-left text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-xs font-bold">
                          <tr>
                            <th className="px-6 py-4">{t("assignments.staffMember")}</th>
                            <th className="px-6 py-4">{t("assignments.assignedArea")}</th>
                            <th className="px-6 py-4">{t("assignments.assignedByCol")}</th>
                            <th className="px-6 py-4">{t("assignments.notes")}</th>
                            <th className="px-6 py-4 text-right">{t("common.actions")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {rows.map((assignment) => (
                            <tr key={assignment.id} className="hover:bg-slate-50/50 transition-colors group">
                              <td className="px-6 py-4 font-bold text-slate-800">
                                {assignment.staffName}
                              </td>
                              <td className="px-6 py-4">
                                <span className="font-medium text-slate-700">{assignment.areaName}</span>
                              </td>
                              <td className="px-6 py-4 text-slate-500">
                                {assignment.assignedByName}
                              </td>
                              <td className="px-6 py-4 text-slate-500 max-w-xs truncate">
                                {assignment.isSpecial && <Star className="inline w-3 h-3 text-amber-500 mr-1" />}
                                {assignment.notes || '-'}
                              </td>
                              <td className="px-6 py-4 text-right">
                                <button
                                  onClick={() => removeAssignment(assignment.id)}
                                  className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                  title={t("assignments.removeAssignmentTitle")}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  );
                })}
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}
