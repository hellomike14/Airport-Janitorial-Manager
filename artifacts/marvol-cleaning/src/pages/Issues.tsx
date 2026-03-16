import React, { useState } from "react";
import { format } from "date-fns";
import { 
  useListIssues, 
  useCreateIssue, 
  useResolveIssue,
  useListAreas
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertOctagon, CheckCircle2, AlertTriangle, Plus, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";

export default function Issues() {
  const queryClient = useQueryClient();
  const [isReporting, setIsReporting] = useState(false);
  const [filterResolved, setFilterResolved] = useState<boolean | null>(false);
  
  const { data: issues, isLoading } = useListIssues();
  const { data: areas } = useListAreas();

  const currentUserId = 1; // Mock user ID

  const [formData, setFormData] = useState({
    areaId: '', description: '', severity: 'medium' as any
  });

  const createMutation = useCreateIssue({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/issues"] });
        setIsReporting(false);
        setFormData({ areaId: '', description: '', severity: 'medium' });
      }
    }
  });

  const resolveMutation = useResolveIssue({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/issues"] })
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      data: {
        areaId: parseInt(formData.areaId),
        description: formData.description,
        severity: formData.severity,
        reportedById: currentUserId
      }
    });
  };

  const filteredIssues = issues?.filter(i => {
    if (filterResolved === null) return true;
    return i.resolved === filterResolved;
  });

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900 text-rose-950">Issue Tracker</h1>
          <p className="text-slate-500 mt-1 font-medium">Report and monitor maintenance or cleaning issues.</p>
        </div>
        
        <div className="flex gap-3">
          <div className="bg-white p-1 rounded-xl border border-slate-200 flex text-sm font-medium">
            <button 
              onClick={() => setFilterResolved(false)} 
              className={`px-4 py-1.5 rounded-lg transition-colors ${filterResolved === false ? 'bg-rose-100 text-rose-800' : 'text-slate-500 hover:bg-slate-100'}`}
            >
              Open
            </button>
            <button 
              onClick={() => setFilterResolved(true)} 
              className={`px-4 py-1.5 rounded-lg transition-colors ${filterResolved === true ? 'bg-emerald-100 text-emerald-800' : 'text-slate-500 hover:bg-slate-100'}`}
            >
              Resolved
            </button>
            <button 
              onClick={() => setFilterResolved(null)} 
              className={`px-4 py-1.5 rounded-lg transition-colors ${filterResolved === null ? 'bg-slate-200 text-slate-800' : 'text-slate-500 hover:bg-slate-100'}`}
            >
              All
            </button>
          </div>
          
          <Button 
            onClick={() => setIsReporting(!isReporting)}
            className="bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-md shadow-rose-600/20 font-bold"
          >
            <Plus className="w-4 h-4 mr-2" /> Report Issue
          </Button>
        </div>
      </div>

      {isReporting && (
        <div className="bg-rose-50 rounded-3xl p-6 border border-rose-100 shadow-sm animate-fade-in-up">
          <h3 className="text-lg font-bold text-rose-900 mb-4 flex items-center gap-2">
            <AlertOctagon className="w-5 h-5" /> New Issue Report
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-rose-900 mb-1">Location / Area</label>
                <select required value={formData.areaId} onChange={e => setFormData({...formData, areaId: e.target.value})} className="w-full bg-white border border-rose-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-rose-500/20">
                  <option value="">-- Choose Area --</option>
                  {areas?.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-rose-900 mb-1">Severity Level</label>
                <select required value={formData.severity} onChange={e => setFormData({...formData, severity: e.target.value as any})} className="w-full bg-white border border-rose-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-rose-500/20 font-medium">
                  <option value="low">Low - Minor issue, normal cleaning</option>
                  <option value="medium">Medium - Needs attention soon</option>
                  <option value="high">High - Urgent maintenance/spill</option>
                </select>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-rose-900 mb-1">Description</label>
              <textarea required rows={3} value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Describe the issue in detail..." className="w-full bg-white border border-rose-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-rose-500/20 resize-none" />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="ghost" onClick={() => setIsReporting(false)} className="rounded-xl text-rose-700 hover:bg-rose-100">Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending} className="bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-md shadow-rose-600/20 px-6 font-bold">
                {createMutation.isPending ? "Submitting..." : "Submit Report"}
              </Button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-4">
        {isLoading && <div className="p-8 text-center text-slate-500 animate-pulse bg-white rounded-3xl">Loading issues...</div>}
        
        {filteredIssues?.map(issue => (
          <div key={issue.id} className={`p-5 rounded-2xl border transition-all duration-200 flex flex-col sm:flex-row gap-4 sm:items-center ${
            issue.resolved 
              ? 'bg-slate-50 border-slate-200 opacity-75' 
              : issue.severity === 'high' 
                ? 'bg-white border-rose-200 shadow-md shadow-rose-100' 
                : 'bg-white border-slate-200 shadow-sm hover:border-slate-300'
          }`}>
            <div className="shrink-0">
              {issue.resolved ? (
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
              ) : issue.severity === 'high' ? (
                <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center animate-pulse">
                  <AlertOctagon className="w-6 h-6" />
                </div>
              ) : (
                <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6" />
                </div>
              )}
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-slate-900">{issue.areaName}</span>
                <span className="text-slate-300">•</span>
                <span className="text-sm text-slate-500">{format(new Date(issue.issueDate), "MMM do, h:mm a")}</span>
              </div>
              <p className={`text-base ${issue.resolved ? 'text-slate-500 line-through' : 'text-slate-700'}`}>
                {issue.description}
              </p>
              <p className="text-xs text-slate-400 mt-2 font-medium uppercase tracking-wider">
                Reported by: {issue.reportedByName}
              </p>
            </div>
            
            <div className="shrink-0 flex flex-row sm:flex-col items-center sm:items-end gap-3 justify-between">
               <StatusBadge status={
                 issue.resolved ? 'success' : 
                 issue.severity === 'high' ? 'danger' : 
                 issue.severity === 'medium' ? 'warning' : 'neutral'
               } className="uppercase !text-[10px] tracking-wider">
                 {issue.resolved ? 'Resolved' : `${issue.severity} Priority`}
               </StatusBadge>
               
               {!issue.resolved && (
                 <Button 
                   onClick={() => {
                     if(confirm("Mark this issue as resolved?")) {
                       resolveMutation.mutate({ id: issue.id });
                     }
                   }}
                   disabled={resolveMutation.isPending}
                   variant="outline"
                   className="rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 text-xs h-8 px-3"
                 >
                   <CheckCircle2 className="w-3 h-3 mr-1" /> Mark Resolved
                 </Button>
               )}
            </div>
          </div>
        ))}
        
        {(!filteredIssues || filteredIssues.length === 0) && !isLoading && (
          <div className="p-12 text-center bg-white rounded-3xl border border-slate-200 border-dashed">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3 opacity-50" />
            <h3 className="text-lg font-bold text-slate-700">All Clear!</h3>
            <p className="text-slate-500 mt-1">No issues matching this filter.</p>
          </div>
        )}
      </div>
    </div>
  );
}
