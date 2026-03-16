import React, { useState } from "react";
import { useListStaff, useCreateStaffMember, useDeleteStaffMember } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { UserPlus, Shield, User, Phone, Mail, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";

export default function Staff() {
  const { data: staff, isLoading } = useListStaff();
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  
  const [formData, setFormData] = useState({ name: '', role: 'staff', phone: '', email: '' });

  const createMutation = useCreateStaffMember({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
        setIsAdding(false);
        setFormData({ name: '', role: 'staff', phone: '', email: '' });
      }
    }
  });

  const deleteMutation = useDeleteStaffMember({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/staff"] })
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({ data: formData as any });
  };

  const handleDelete = (id: number) => {
    if (confirm("Remove this staff member?")) {
      deleteMutation.mutate({ id });
    }
  };

  if (isLoading) return <div className="p-8 animate-pulse text-slate-500">Loading staff directory...</div>;

  const supervisors = staff?.filter(s => s.role === 'supervisor') || [];
  const regularStaff = staff?.filter(s => s.role === 'staff') || [];

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900">Staff Directory</h1>
          <p className="text-slate-500 mt-1 font-medium">Manage supervisors and cleaning personnel ({staff?.length} total).</p>
        </div>
        <Button 
          onClick={() => setIsAdding(!isAdding)}
          className="bg-accent hover:bg-accent/90 text-white rounded-xl shadow-lg shadow-accent/20 font-bold"
        >
          <UserPlus className="w-4 h-4 mr-2" /> Add Staff Member
        </Button>
      </div>

      {isAdding && (
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-md animate-fade-in-up">
          <h3 className="text-lg font-bold text-slate-800 mb-4">New Staff Member</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Full Name</label>
              <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Role</label>
              <select value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all">
                <option value="staff">Cleaning Staff</option>
                <option value="supervisor">Supervisor</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Phone (Optional)</label>
              <input value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Email (Optional)</label>
              <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all" />
            </div>
            <div className="md:col-span-2 flex justify-end gap-3 mt-2">
              <Button type="button" variant="outline" onClick={() => setIsAdding(false)} className="rounded-xl">Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending} className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl">
                {createMutation.isPending ? "Saving..." : "Save Member"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Supervisors Section */}
      <div>
        <h2 className="text-xl font-display font-bold text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-200 pb-2">
          <Shield className="w-5 h-5 text-indigo-500" /> Supervisors ({supervisors.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {supervisors.map(person => (
            <StaffCard key={person.id} person={person} onDelete={() => handleDelete(person.id)} isSuper />
          ))}
        </div>
      </div>

      {/* Staff Section */}
      <div className="pt-4">
        <h2 className="text-xl font-display font-bold text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-200 pb-2">
          <User className="w-5 h-5 text-emerald-500" /> Cleaning Staff ({regularStaff.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {regularStaff.map(person => (
            <StaffCard key={person.id} person={person} onDelete={() => handleDelete(person.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function StaffCard({ person, onDelete, isSuper }: any) {
  return (
    <div className={`bg-white rounded-2xl p-5 border shadow-sm relative group overflow-hidden ${isSuper ? 'border-indigo-100 shadow-indigo-500/5' : 'border-slate-200'}`}>
      {isSuper && <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-accent" />}
      
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${isSuper ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-700'}`}>
            {person.name.charAt(0)}
          </div>
          <div>
            <h3 className="font-bold text-slate-900 leading-tight">{person.name}</h3>
            <StatusBadge status={isSuper ? 'info' : 'neutral'} className="mt-1 font-medium py-0.5 text-[10px]">
              {person.role.toUpperCase()}
            </StatusBadge>
          </div>
        </div>
        <button onClick={onDelete} className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      
      <div className="space-y-2 text-sm text-slate-500">
        <div className="flex items-center gap-2">
          <Phone className="w-4 h-4 text-slate-400" /> {person.phone || 'No phone added'}
        </div>
        <div className="flex items-center gap-2 truncate">
          <Mail className="w-4 h-4 text-slate-400 shrink-0" /> {person.email || 'No email added'}
        </div>
      </div>
    </div>
  );
}
