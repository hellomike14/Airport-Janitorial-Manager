import React, { useState } from "react";
import { useListStaff, useCreateStaffMember, useDeleteStaffMember, useUpdateStaffMember } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { UserPlus, Shield, User, Phone, Mail, Trash2, Lock, ArrowUpDown, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";

export default function Staff() {
  const { t } = useTranslation();
  const { data: staff, isLoading } = useListStaff();
  const { currentUser, logout } = useAuth();
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({ name: "", role: "staff", phone: "", email: "" });

  const createMutation = useCreateStaffMember({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
        setIsAdding(false);
        setFormData({ name: "", role: "staff", phone: "", email: "" });
      },
    },
  });

  const deleteMutation = useDeleteStaffMember({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/staff"] }),
    },
  });

  const updateMutation = useUpdateStaffMember({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/staff"] }),
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({ data: formData as any });
  };

  const handleDelete = (id: number) => {
    if (confirm(t("staff.removeStaffMember"))) {
      deleteMutation.mutate({ id });
    }
  };

  const handleToggleRole = (person: any) => {
    const newRole = person.role === "staff" ? "supervisor" : "staff";
    const label = newRole === "supervisor" ? t("roles.supervisor") : t("roles.staff");
    if (confirm(t("staff.switchRole", { name: person.name, role: label }))) {
      updateMutation.mutate({ id: person.id, data: { role: newRole } });
    }
  };

  if (isLoading) return <div className="p-8 animate-pulse text-slate-500">{t("staff.loadingDirectory")}</div>;

  const admins = staff?.filter((s) => s.role === "admin") || [];
  const supervisors = staff?.filter((s) => s.role === "supervisor") || [];
  const regularStaff = staff?.filter((s) => s.role === "staff") || [];

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900">{t("staff.staffDirectory")}</h1>
          <p className="text-slate-500 mt-1 font-medium">
            {t("staff.subtitle", { admins: admins.length, supervisors: supervisors.length, staff: regularStaff.length })}
          </p>
        </div>
        <Button
          onClick={() => setIsAdding(!isAdding)}
          className="bg-accent hover:bg-accent/90 text-white rounded-xl shadow-lg shadow-accent/20 font-bold"
        >
          <UserPlus className="w-4 h-4 mr-2" /> {t("staff.addMember")}
        </Button>
      </div>

      {isAdding && (
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-md">
          <h3 className="text-lg font-bold text-slate-800 mb-4">{t("staff.newTeamMember")}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">{t("staff.fullName")}</label>
              <input
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
                placeholder={t("staff.fullNamePlaceholder")}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">{t("staff.role")}</label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
              >
                <option value="staff">{t("roles.cleaningStaff")}</option>
                <option value="supervisor">{t("roles.supervisor")}</option>
                <option value="admin">{t("roles.administrator")}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">{t("staff.phoneOptional")}</label>
              <input
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
                placeholder={t("staff.phonePlaceholder")}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">{t("staff.emailOptional")}</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
                placeholder={t("staff.emailPlaceholder")}
              />
            </div>
            <div className="md:col-span-2 flex justify-end gap-3 mt-2">
              <Button type="button" variant="outline" onClick={() => setIsAdding(false)} className="rounded-xl">
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={createMutation.isPending} className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl">
                {createMutation.isPending ? t("staff.saving") : t("staff.saveMember")}
              </Button>
            </div>
          </form>
        </div>
      )}

      {admins.length > 0 && (
        <div>
          <h2 className="text-xl font-display font-bold text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-200 pb-2">
            <Lock className="w-5 h-5 text-violet-500" /> {t("staff.administrators")} ({admins.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {admins.map((person) => (
              <StaffCard key={person.id} person={person} onDelete={() => handleDelete(person.id)} roleType="admin" onLogout={currentUser?.id === person.id ? logout : undefined} />
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-xl font-display font-bold text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-200 pb-2">
          <Shield className="w-5 h-5 text-indigo-500" /> {t("staff.supervisors")} ({supervisors.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {supervisors.map((person) => (
            <StaffCard key={person.id} person={person} onDelete={() => handleDelete(person.id)} onToggleRole={() => handleToggleRole(person)} roleType="supervisor" onLogout={currentUser?.id === person.id ? logout : undefined} />
          ))}
        </div>
      </div>

      <div className="pt-4">
        <h2 className="text-xl font-display font-bold text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-200 pb-2">
          <User className="w-5 h-5 text-emerald-500" /> {t("staff.cleaningStaff")} ({regularStaff.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {regularStaff.map((person) => (
            <StaffCard key={person.id} person={person} onDelete={() => handleDelete(person.id)} onToggleRole={() => handleToggleRole(person)} roleType="staff" onLogout={currentUser?.id === person.id ? logout : undefined} />
          ))}
        </div>
      </div>
    </div>
  );
}

const ROLE_STYLES = {
  admin: {
    border: "border-violet-100 shadow-violet-500/5",
    bar: "from-violet-500 to-indigo-500",
    avatar: "bg-violet-100 text-violet-700",
    badge: "info" as const,
  },
  supervisor: {
    border: "border-indigo-100 shadow-indigo-500/5",
    bar: "from-indigo-500 to-blue-500",
    avatar: "bg-indigo-100 text-indigo-700",
    badge: "info" as const,
  },
  staff: {
    border: "border-slate-200",
    bar: "from-emerald-400 to-teal-500",
    avatar: "bg-slate-100 text-slate-700",
    badge: "neutral" as const,
  },
};

function StaffCard({ person, onDelete, onToggleRole, roleType, onLogout }: { person: any; onDelete: () => void; onToggleRole?: () => void; roleType: "admin" | "supervisor" | "staff"; onLogout?: () => void }) {
  const { t } = useTranslation();
  const style = ROLE_STYLES[roleType];
  const initials = person.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className={`bg-white rounded-2xl p-5 border shadow-sm relative group overflow-hidden ${style.border}`}>
      <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${style.bar}`} />
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-base font-bold ${style.avatar}`}>
            {initials}
          </div>
          <div>
            <h3 className="font-bold text-slate-900 leading-tight">{person.name}</h3>
            <StatusBadge status={style.badge} className="mt-1 font-medium py-0.5 text-[10px]">
              {person.role.toUpperCase()}
            </StatusBadge>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onToggleRole && (
            <button
              onClick={onToggleRole}
              title={roleType === "staff" ? t("staff.switchToSupervisor") : t("staff.switchToStaff")}
              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            >
              <ArrowUpDown className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 active:bg-rose-100 rounded-lg transition-colors touch-manipulation"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="space-y-2 text-sm text-slate-500">
        <div className="flex items-center gap-2">
          <Phone className="w-4 h-4 text-slate-400" />
          {person.phone || t("staff.noPhoneAdded")}
        </div>
        <div className="flex items-center gap-2 truncate">
          <Mail className="w-4 h-4 text-slate-400 shrink-0" />
          {person.email || t("staff.noEmailAdded")}
        </div>
      </div>
      {onToggleRole && (
        <button
          onClick={onToggleRole}
          className="mt-4 w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 active:bg-indigo-200 text-indigo-700 font-semibold text-sm border border-indigo-200 transition-colors touch-manipulation"
        >
          <ArrowUpDown className="w-4 h-4" />
          {roleType === "staff" ? t("staff.switchToSupervisor") : t("staff.switchToStaff")}
        </button>
      )}
      {onLogout && (
        <button
          onClick={onLogout}
          className="mt-3 w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-red-50 hover:bg-red-100 active:bg-red-200 text-red-600 font-semibold text-sm border border-red-200 transition-colors touch-manipulation"
        >
          <LogOut className="w-4 h-4" />
          {t("layout.logout")}
        </button>
      )}
    </div>
  );
}
