import React, { useState } from "react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { getDateLocale } from "@/i18n/dateLocale";
import { 
  useListAssignments, 
  useCreateAssignment, 
  useDeleteAssignment,
  useListStaff,
  useListAreas
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Calendar, Trash2, Plus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

export default function Assignments() {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateLocale(i18n.language);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const { currentUser } = useAuth();
  
  const { data: assignments, isLoading } = useListAssignments({ date: selectedDate });
  const { data: staff } = useListStaff();
  const { data: areas } = useListAreas();

  const currentUserId = currentUser?.id ?? 0;

  const [formData, setFormData] = useState({
    staffId: '', areaId: '', notes: '', isSpecial: false
  });

  const createMutation = useCreateAssignment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/assignments"] });
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
        setIsAdding(false);
        setFormData({ staffId: '', areaId: '', notes: '', isSpecial: false });
      }
    }
  });

  const deleteMutation = useDeleteAssignment({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/assignments"] })
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      data: {
        staffId: parseInt(formData.staffId),
        areaId: parseInt(formData.areaId),
        assignmentDate: selectedDate,
        assignedById: currentUserId,
        notes: formData.notes,
        isSpecial: formData.isSpecial
      }
    });
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
              onChange={(e) => setSelectedDate(e.target.value)}
              className="font-bold text-slate-700 bg-transparent outline-none cursor-pointer"
            />
          </div>
          <div className="h-8 w-px bg-slate-200 mx-2" />
          <Button 
            onClick={() => setIsAdding(!isAdding)}
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-indigo-900 mb-1">{t("assignments.selectStaff")}</label>
                <select required value={formData.staffId} onChange={e => setFormData({...formData, staffId: e.target.value})} className="w-full bg-white border border-indigo-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                  <option value="">{t("assignments.chooseStaffMember")}</option>
                  {staff?.filter(s => s.role === 'staff').map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-indigo-900 mb-1">{t("assignments.selectArea")}</label>
                <select required value={formData.areaId} onChange={e => setFormData({...formData, areaId: e.target.value})} className="w-full bg-white border border-indigo-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                  <option value="">{t("assignments.chooseArea")}</option>
                  {areas?.map(a => (
                    <option key={a.id} value={a.id}>{a.name} ({a.terminal})</option>
                  ))}
                </select>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-indigo-900 mb-1">{t("assignments.specialInstructions")}</label>
              <input value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} placeholder={t("assignments.specialInstructionsPlaceholder")} className="w-full bg-white border border-indigo-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-indigo-800 bg-white px-4 py-2 rounded-xl border border-indigo-200">
                <input type="checkbox" checked={formData.isSpecial} onChange={e => setFormData({...formData, isSpecial: e.target.checked})} className="w-4 h-4 text-indigo-600 rounded" />
                <Star className="w-4 h-4 text-amber-500" />
                {t("assignments.markSpecial")}
              </label>
              
              <div className="sm:flex-1" />
              <div className="flex gap-3 justify-end">
                <Button type="button" variant="ghost" onClick={() => setIsAdding(false)} className="rounded-xl text-indigo-700 hover:bg-indigo-100">{t("common.cancel")}</Button>
                <Button type="submit" disabled={createMutation.isPending} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md shadow-indigo-600/20 px-6 font-bold">
                  {createMutation.isPending ? t("assignments.assigning") : t("assignments.confirmAssignment")}
                </Button>
              </div>
            </div>
          </form>
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
          <>
            <div className="sm:hidden divide-y divide-slate-100">
              {assignments.map((assignment) => (
                <div key={assignment.id} className="p-4 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 text-sm">{assignment.staffName}</p>
                    <p className="text-sm text-slate-600 mt-0.5 font-medium">{assignment.areaName}</p>
                    {(assignment.notes || assignment.isSpecial) && (
                      <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                        {assignment.isSpecial && <Star className="w-3 h-3 text-amber-500 shrink-0" />}
                        {assignment.notes || ''}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      if (confirm(t("assignments.removeAssignment"))) {
                        deleteMutation.mutate({ id: assignment.id });
                      }
                    }}
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
                  <th className="px-6 py-4">{t("assignments.notes")}</th>
                  <th className="px-6 py-4 text-right">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assignments.map((assignment) => (
                  <tr key={assignment.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-4 font-bold text-slate-800">
                      {assignment.staffName}
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-medium text-slate-700">{assignment.areaName}</span>
                    </td>
                    <td className="px-6 py-4 text-slate-500 max-w-xs truncate">
                      {assignment.isSpecial && <Star className="inline w-3 h-3 text-amber-500 mr-1" />}
                      {assignment.notes || '-'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => {
                          if (confirm(t("assignments.removeAssignment"))) {
                            deleteMutation.mutate({ id: assignment.id });
                          }
                        }}
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
          </>
        )}
      </div>
    </div>
  );
}
