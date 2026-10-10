import React, { useState } from "react";
import { useListStaff, useListFormerStaff, getListFormerStaffQueryKey, useRehireStaffMember, useCreateStaffMember, useDeleteStaffMember, useUpdateStaffMember, getStaffPresence, type StaffPresenceResponse } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Shield, User, Trash2, Lock, ArrowUpDown, LogOut, MailWarning, CheckCircle2, Mail, Phone, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { getConfidentialStaffMembers } from "@workspace/api-client-react";
import { ConfidentialBoundary } from "@/components/confidential/ConfidentialBoundary";
import { AccessHealthSection } from "@/components/AccessHealthSection";

type StaffPresenceEntry = StaffPresenceResponse["staff"][number];

export default function Staff() {
  const { effectiveRole } = useAuth();
  if (effectiveRole === "admin") return <ConfidentialBoundary><StaffPage confidential /></ConfidentialBoundary>;
  return <StaffPage confidential={false} />;
}

function StaffPage({ confidential }: { confidential: boolean }) {
  const { t } = useTranslation();
  const { effectiveRole } = useAuth();
  const readOnly = effectiveRole !== "admin" && effectiveRole !== "employee_administrator";
  const canAssignRoles = effectiveRole === "admin";
  const publicStaff = useListStaff({ query: { queryKey: ["/api/staff"], enabled: !confidential } });
  const secureStaff = useQuery({
    queryKey: ["/api/staff/confidential"],
    enabled: confidential,
    gcTime: 0,
    queryFn: ({ signal }) => getConfidentialStaffMembers(signal),
  });
  const { data: staff, isLoading } = confidential ? secureStaff : publicStaff;
  const { data: formerStaff } = useListFormerStaff({ query: { queryKey: getListFormerStaffQueryKey(), enabled: effectiveRole === "admin" } });
  const { currentUser, logout } = useAuth();
  const queryClient = useQueryClient();
  const presence = useQuery<StaffPresenceResponse>({
    queryKey: ["/api/staff/presence"],
    enabled: effectiveRole === "admin",
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: ({ signal }) => getStaffPresence({ signal, credentials: "same-origin", cache: "no-store" }),
  });
  const presenceFor = (id: number) => effectiveRole === "admin"
    ? presence.data?.staff.find(entry => entry.staffId === id)
    : undefined;
  const refreshStaff = () => { void queryClient.invalidateQueries({ queryKey: ["/api/staff"] }); void queryClient.invalidateQueries({ queryKey: ["/api/staff/confidential"] }); };
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({ name: "", role: "staff", phone: "", email: "" });

  const createMutation = useCreateStaffMember({
    mutation: {
      onSuccess: () => {
        refreshStaff();
        setIsAdding(false);
        setFormData({ name: "", role: "staff", phone: "", email: "" });
      },
      onError: (err: any) =>
        alert(err?.data?.error ?? err?.message ?? t("staff.saveFailed", "Could not save the staff member.")),
    },
  });

  const deleteMutation = useDeleteStaffMember({
    mutation: {
      onSuccess: () => refreshStaff(),
      onError: () => alert(t("staff.removeFailed")),
    },
  });

  const updateMutation = useUpdateStaffMember({
    mutation: {
      onSuccess: () => refreshStaff(),
      onError: (err: any) =>
        alert(err?.data?.error ?? err?.message ?? t("staff.saveFailed", "Could not save the staff member.")),
    },
  });
  const rehireMutation = useRehireStaffMember({
    mutation: {
      onSuccess: () => {
        refreshStaff();
        queryClient.invalidateQueries({ queryKey: ["/api/staff/former"] });
      },
      onError: (err: any) =>
        alert(err?.data?.error ?? err?.message ?? t("staff.rehireFailed")),
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

  const handleSetEmail = (person: any) => {
    const email = window.prompt(
      t("staff.setEmailPrompt", "Login email for {{name}}:", { name: person.name }),
      person.email?.trim() ?? ""
    );
    if (email === null) return;
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      alert(t("staff.emailFormatError", "Please enter a valid email address."));
      return;
    }
    updateMutation.mutate({ id: person.id, data: { email: trimmed } as any });
  };

  const handleRehire = (person: { id: number; name: string }) => {
    if (confirm(t("staff.rehireConfirm", { name: person.name }))) {
      rehireMutation.mutate({ id: person.id });
    }
  };

  const handleToggleRole = (person: any) => {
    const newRole = person.role === "staff" ? "supervisor" : "staff";
    handleSetRole(person, newRole);
  };

  const handleSetRole = (person: any, newRole: "staff" | "supervisor" | "employee_administrator") => {
    const label = newRole === "employee_administrator"
      ? t("roles.employeeAdministrator", "Employee administrator")
      : newRole === "supervisor" ? t("roles.supervisor") : t("roles.staff");
    if (confirm(t("staff.switchRole", { name: person.name, role: label }))) {
      updateMutation.mutate({ id: person.id, data: { role: newRole } });
    }
  };

  if (confidential && secureStaff.isError) return (
    <div role="alert" className="p-8 text-rose-700">{t("confidential.loadFailedBody")} <button className="font-semibold underline" onClick={() => void secureStaff.refetch()}>{t("confidential.retry")}</button></div>
  );
  if (isLoading) return <div className="p-8 animate-pulse text-slate-500">{t("staff.loadingDirectory")}</div>;

  const admins = staff?.filter((s) => s.role === "admin") || [];
  const employeeAdministrators = staff?.filter((s) => s.role === "employee_administrator") || [];
  const supervisors = staff?.filter((s) => s.role === "supervisor") || [];
  const regularStaff = staff?.filter((s) => s.role === "staff") || [];
  const loginDisabledCount = (staff ?? []).filter((person) => {
    const access = person as typeof person & { loginEnabled?: boolean; formerEmployee?: boolean };
    return access.active && access.formerEmployee !== true && (!access.hasEmail || access.loginEnabled !== true);
  }).length;

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900">{t("staff.staffDirectory")}</h1>
          <p className="text-slate-500 mt-1 font-medium">
            {t("staff.subtitle", { admins: admins.length, employeeAdministrators: employeeAdministrators.length, supervisors: supervisors.length, staff: regularStaff.length })}
          </p>
        </div>
        {!readOnly && (
          <Button
            onClick={() => setIsAdding(!isAdding)}
            className="bg-accent hover:bg-accent/90 text-white rounded-xl shadow-lg shadow-accent/20 font-bold"
          >
            <UserPlus className="w-4 h-4 mr-2" /> {t("staff.addMember")}
          </Button>
        )}
      </div>

      {effectiveRole === "admin" && <AccessHealthSection />}
      {effectiveRole === "admin" && (
        <p className="text-sm text-slate-500">
          Active now means a signed-in staff member used the app within the last 2 minutes. Activity refreshes every 30 seconds.
        </p>
      )}

      {loginDisabledCount > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <MailWarning className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-semibold">
              {t("staff.missingEmailBanner", { count: loginDisabledCount })}
            </p>
            <p className="mt-1 text-amber-700">
              {t(
                "staff.migrationHint",
                "An administrator or employee administrator can edit and save an eligible active staff member's email to enable sign-in."
              )}
            </p>
          </div>
        </div>
      )}

      {!readOnly && isAdding && (
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
            {effectiveRole === "admin" ? <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">{t("staff.role")}</label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
              >
                <option value="staff">{t("roles.cleaningStaff")}</option>
                <option value="supervisor">{t("roles.supervisor")}</option>
                <option value="admin">{t("roles.administrator")}</option>
                <option value="employee_administrator">{t("roles.employeeAdministrator", "Employee administrator")}</option>
              </select>
            </div> : <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">{t("staff.role")}</label>
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700">
                {t("roles.cleaningStaff")}
              </p>
            </div>}
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
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                {t("staff.emailRequired", "Email (used to sign in)")}
              </label>
              <input
                type="email"
                required
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
              <StaffCard
                key={person.id}
                person={person}
                presence={presenceFor(person.id)}
                presenceUnavailable={effectiveRole === "admin" && presence.isError}
                onDelete={!canAssignRoles ? undefined : () => handleDelete(person.id)}
                onSetEmail={readOnly ? undefined : () => handleSetEmail(person)}
                roleType="admin"
                onLogout={currentUser?.id === person.id ? logout : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {employeeAdministrators.length > 0 && (
        <div>
          <h2 className="text-xl font-display font-bold text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-200 pb-2">
            <Shield className="w-5 h-5 text-cyan-600" /> {t("roles.employeeAdministrator", "Employee administrators")} ({employeeAdministrators.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {employeeAdministrators.map((person) => (
              <StaffCard
                key={person.id}
                person={person}
                presence={presenceFor(person.id)}
                presenceUnavailable={effectiveRole === "admin" && presence.isError}
                onDelete={canAssignRoles ? () => handleDelete(person.id) : undefined}
                onToggleRole={canAssignRoles ? () => handleSetRole(person, "staff") : undefined}
                onSetEmail={readOnly ? undefined : () => handleSetEmail(person)}
                roleType="employee_administrator"
              />
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
            <StaffCard
              key={person.id}
              person={person}
              presence={presenceFor(person.id)}
              presenceUnavailable={effectiveRole === "admin" && presence.isError}
              onDelete={canAssignRoles ? () => handleDelete(person.id) : undefined}
              onToggleRole={canAssignRoles ? () => handleToggleRole(person) : undefined}
              onSetEmail={readOnly ? undefined : () => handleSetEmail(person)}
              roleType="supervisor"
              onLogout={currentUser?.id === person.id ? logout : undefined}
            />
          ))}
        </div>
      </div>

      <div className="pt-4">
        <h2 className="text-xl font-display font-bold text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-200 pb-2">
          <User className="w-5 h-5 text-emerald-500" /> {t("staff.cleaningStaff")} ({regularStaff.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {regularStaff.map((person) => (
            <StaffCard
              key={person.id}
              person={person}
              presence={presenceFor(person.id)}
              presenceUnavailable={effectiveRole === "admin" && presence.isError}
              onDelete={canAssignRoles ? () => handleDelete(person.id) : undefined}
              onToggleRole={canAssignRoles ? () => handleToggleRole(person) : undefined}
              onAssignEmployeeAdministrator={canAssignRoles ? () => handleSetRole(person, "employee_administrator") : undefined}
              onSetEmail={readOnly ? undefined : () => handleSetEmail(person)}
              roleType="staff"
              onLogout={currentUser?.id === person.id ? logout : undefined}
            />
          ))}
        </div>
      </div>
      {effectiveRole === "admin" && formerStaff && formerStaff.length > 0 && (
        <section className="pt-4 border-t border-slate-200">
          <h2 className="text-xl font-display font-bold text-slate-800 mb-2">{t("staff.formerStaff")}</h2>
          <p className="text-sm text-slate-500 mb-4">{t("staff.rehireHint")}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {formerStaff.map((person) => (
              <div key={person.id} className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between gap-3">
                <span className="font-semibold text-slate-800">{person.name}</span>
                <Button type="button" variant="outline" disabled={rehireMutation.isPending}
                  onClick={() => handleRehire(person)}>
                  <RotateCcw className="w-4 h-4 mr-2" />{t("staff.rehire")}
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
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
  employee_administrator: {
    border: "border-cyan-100 shadow-cyan-500/5",
    bar: "from-cyan-500 to-teal-500",
    avatar: "bg-cyan-100 text-cyan-700",
    badge: "info" as const,
  },
  staff: {
    border: "border-slate-200",
    bar: "from-emerald-400 to-teal-500",
    avatar: "bg-slate-100 text-slate-700",
    badge: "neutral" as const,
  },
};

function StaffCard({ person, presence, presenceUnavailable = false, onDelete, onToggleRole, onAssignEmployeeAdministrator, roleType, onLogout, onSetEmail }: { person: any; presence?: StaffPresenceEntry; presenceUnavailable?: boolean; onDelete?: () => void; onToggleRole?: () => void; onAssignEmployeeAdministrator?: () => void; roleType: "admin" | "supervisor" | "staff" | "employee_administrator"; onLogout?: () => void; onSetEmail?: () => void }) {
  const { t } = useTranslation();
  const style = ROLE_STYLES[roleType];
  const initials = person.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
  const hasEmail = Boolean(person.hasEmail);
  const isEligibleForLogin = person.active === true && person.formerEmployee !== true;
  const canLogIn = isEligibleForLogin && person.loginEnabled === true;

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
          {onDelete && (
            <button
              onClick={onDelete}
              className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 active:bg-rose-100 rounded-lg transition-colors touch-manipulation"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      <div className="space-y-2 text-sm text-slate-500">
        {person.email?.trim() && (
          <div className="flex items-start gap-2" data-testid={`staff-email-${person.id}`}>
            <Mail aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-all">{person.email}</span>
          </div>
        )}
        {person.phone?.trim() && (
          <div className="flex items-start gap-2" data-testid={`staff-phone-${person.id}`}>
            <Phone aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{person.phone}</span>
          </div>
        )}
        {(presence || presenceUnavailable) && (
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600" data-testid={`staff-presence-${person.id}`}>
            {presenceUnavailable ? (
              <span>Status unavailable</span>
            ) : presence?.activeNow ? (
              <><span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500" /><span>Active now</span></>
            ) : presence?.lastSeenAt ? (
              <span>Last active {new Date(presence.lastSeenAt).toLocaleString()}</span>
            ) : (
              <span>No activity yet</span>
            )}
          </div>
        )}
        {canLogIn ? (
          <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {t("staff.canLogIn", "Can sign in with this email")}
          </div>
        ) : !isEligibleForLogin ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-600">
            <div className="flex items-center gap-1.5 font-semibold">
              <MailWarning className="w-3.5 h-3.5 shrink-0" />
              {t("staff.loginDisabled")}
            </div>
            <p className="mt-1 leading-relaxed">{t("staff.inactiveLoginHint")}</p>
          </div>
        ) : hasEmail ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-2 text-xs text-amber-800">
            <div className="flex items-center gap-1.5 font-semibold">
              <MailWarning className="w-3.5 h-3.5 shrink-0" />
              {t("staff.loginDisabled")}
            </div>
            <p className="mt-1 leading-relaxed">{t("staff.loginDisabledHint")}</p>
            {onSetEmail && (
              <button
                type="button"
                onClick={onSetEmail}
                className="mt-2 font-bold text-amber-800 underline underline-offset-2 hover:text-amber-950"
              >
                {t("staff.editAndSaveEmail")}
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={onSetEmail}
            disabled={!onSetEmail}
            className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 hover:bg-amber-100 transition-colors disabled:cursor-default disabled:hover:bg-amber-50"
          >
            <MailWarning className="w-3.5 h-3.5" />
            {t("staff.noEmailCannotLogIn", "No email — cannot sign in. Add one.")}
          </button>
        )}
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
      {onAssignEmployeeAdministrator && (
        <button
          type="button"
          onClick={onAssignEmployeeAdministrator}
          className="mt-2 w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-cyan-50 hover:bg-cyan-100 text-cyan-800 font-semibold text-sm border border-cyan-200 transition-colors touch-manipulation"
        >
          <Shield className="w-4 h-4" />
          {t("staff.makeEmployeeAdministrator", "Make employee administrator")}
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
