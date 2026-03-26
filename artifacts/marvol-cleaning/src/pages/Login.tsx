import React, { useState } from "react";
import { useListStaff } from "@workspace/api-client-react";
import { useAuth, UserRole } from "@/contexts/AuthContext";
import { Shield, Users, User, LogIn, ClipboardCheck } from "lucide-react";

const ROLE_CONFIG = {
  admin: {
    label: "Administrator",
    icon: Shield,
    color: "from-violet-600 to-indigo-600",
    bg: "bg-violet-50 border-violet-200",
    badge: "bg-violet-100 text-violet-700",
    description: "Full access — staff management, all areas, reports",
  },
  inspector: {
    label: "Inspector",
    icon: ClipboardCheck,
    color: "from-blue-600 to-cyan-500",
    bg: "bg-blue-50 border-blue-200",
    badge: "bg-blue-100 text-blue-700",
    description: "Enter information on open issues and view completed tasks",
  },
  supervisor: {
    label: "Supervisor",
    icon: Users,
    color: "from-emerald-600 to-teal-500",
    bg: "bg-emerald-50 border-emerald-200",
    badge: "bg-emerald-100 text-emerald-800",
    description: "Dashboard, assignments, areas, and issue tracking",
  },
  staff: {
    label: "Staff",
    icon: User,
    color: "from-emerald-500 to-teal-500",
    bg: "bg-emerald-50 border-emerald-200",
    badge: "bg-emerald-100 text-emerald-700",
    description: "View assigned tasks and report issues",
  },
};

export default function Login() {
  const { data: staffList, isLoading } = useListStaff();
  const { login } = useAuth();
  const [selecting, setSelecting] = useState<number | null>(null);

  const handleLogin = (member: NonNullable<typeof staffList>[number]) => {
    setSelecting(member.id);
    login({
      id: member.id,
      name: member.name,
      role: member.role as UserRole,
      phone: member.phone,
      email: member.email,
    });
  };

  const byRole = {
    admin: (staffList ?? []).filter((s) => s.role === "admin" && s.active),
    inspector: (staffList ?? []).filter((s) => s.role === "inspector" && s.active),
    supervisor: (staffList ?? []).filter((s) => s.role === "supervisor" && s.active),
    staff: (staffList ?? []).filter((s) => s.role === "staff" && s.active),
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-950 via-green-900 to-emerald-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <div className="text-center mb-10 relative z-10">
        <div className="flex flex-col items-center gap-4 mb-5">
          <img
            src={`${import.meta.env.BASE_URL}logo-mark.png`}
            alt="Marvol Facility Services"
            className="w-24 h-24 object-contain drop-shadow-2xl"
          />
          <div className="bg-white/95 backdrop-blur rounded-2xl px-6 py-2.5 shadow-2xl shadow-black/30">
            <img
              src={`${import.meta.env.BASE_URL}logo.png`}
              alt="Marvol Enterprises"
              className="h-10 object-contain"
            />
          </div>
        </div>
        <p className="text-emerald-300 mt-1 text-sm font-medium tracking-wide uppercase">MCO International Airport</p>
        <p className="text-slate-400 mt-3 text-sm">Select your profile to continue</p>
      </div>

      {/* Role sections */}
      {isLoading ? (
        <div className="text-emerald-300 text-sm">Loading staff...</div>
      ) : (
        <div className="w-full max-w-3xl space-y-5 relative z-10">
          {(["admin", "inspector", "supervisor", "staff"] as const).map((role) => {
            const cfg = ROLE_CONFIG[role];
            const Icon = cfg.icon;
            const members = byRole[role];
            if (members.length === 0) return null;
            return (
              <div key={role} className={`rounded-2xl border ${cfg.bg} p-4`}>
                {/* Role header */}
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${cfg.color} flex items-center justify-center shadow-md`}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-slate-800">{cfg.label}</h2>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.badge}`}>
                        {members.length} {members.length === 1 ? "user" : "users"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">{cfg.description}</p>
                  </div>
                </div>
                {/* Member cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {members.map((member) => {
                    const initials = member.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
                    return (
                      <button
                        key={member.id}
                        onClick={() => handleLogin(member)}
                        disabled={selecting !== null}
                        className="flex items-center gap-3 bg-white/80 hover:bg-white border border-white/60 hover:border-slate-200 rounded-xl p-3 text-left transition-all hover:shadow-md active:scale-95 group disabled:opacity-60"
                      >
                        <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${cfg.color} flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm`}>
                          {selecting === member.id ? (
                            <span className="animate-spin text-base">⟳</span>
                          ) : initials}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate leading-tight">{member.name}</p>
                          {member.phone && (
                            <p className="text-xs text-slate-400 truncate">{member.phone}</p>
                          )}
                        </div>
                        <LogIn className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 ml-auto shrink-0 transition-colors" />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-slate-600 text-xs mt-8 relative z-10">Marvol Facility Services · MCO Airport · Internal System</p>
    </div>
  );
}
