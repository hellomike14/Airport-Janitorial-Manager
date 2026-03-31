import React, { useState, useMemo } from "react";
import { useListStaff, useListAssignments } from "@workspace/api-client-react";
import { format } from "date-fns";
import { useAuth, UserRole } from "@/contexts/AuthContext";
import { Shield, Users, User, LogIn, ClipboardCheck, Lock, X, Eye, EyeOff } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

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
  const today = format(new Date(), "yyyy-MM-dd");
  const { data: todayAssignments } = useListAssignments({ date: today });
  const { login } = useAuth();
  const [selecting, setSelecting] = useState<number | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<{ member: NonNullable<typeof staffList>[number] } | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const assignedStaffIds = useMemo(() => {
    return new Set((todayAssignments ?? []).map((a) => a.staffId));
  }, [todayAssignments]);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = (member: NonNullable<typeof staffList>[number]) => {
    if ((member as any).hasPassword) {
      setPasswordPrompt({ member });
      setPassword("");
      setPasswordError(false);
      setShowPassword(false);
      return;
    }
    setSelecting(member.id);
    login({
      id: member.id,
      name: member.name,
      role: member.role as UserRole,
      phone: member.phone,
      email: member.email,
    });
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordPrompt) return;
    setVerifying(true);
    setPasswordError(false);
    try {
      const res = await fetch(`${BASE_URL}/api/staff/verify-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: passwordPrompt.member.id, password }),
      });
      if (res.ok) {
        const member = passwordPrompt.member;
        setPasswordPrompt(null);
        setSelecting(member.id);
        login({
          id: member.id,
          name: member.name,
          role: member.role as UserRole,
          phone: member.phone,
          email: member.email,
        });
      } else {
        setPasswordError(true);
      }
    } catch {
      setPasswordError(true);
    } finally {
      setVerifying(false);
    }
  };

  const byRole = {
    admin: (staffList ?? []).filter((s) => s.role === "admin" && s.active),
    inspector: (staffList ?? []).filter((s) => s.role === "inspector" && s.active),
    supervisor: (staffList ?? []).filter((s) => s.role === "supervisor" && s.active),
    staff: (staffList ?? []).filter((s) => s.role === "staff" && s.active),
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-950 via-green-900 to-emerald-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl" />
      </div>

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
                      {role !== "staff" && (
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <Lock className="w-3 h-3" /> Password required
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{cfg.description}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {members.map((member) => {
                    const initials = member.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
                    const isOnShift = role !== "staff" || assignedStaffIds.has(member.id);
                    return (
                      <button
                        key={member.id}
                        onClick={() => handleLogin(member)}
                        disabled={selecting !== null}
                        className={`flex items-center gap-3 border rounded-xl p-3 text-left transition-all active:scale-95 group disabled:opacity-60 ${
                          isOnShift
                            ? "bg-white/80 hover:bg-white border-white/60 hover:border-slate-200 hover:shadow-md"
                            : "bg-white/30 border-white/20 opacity-50"
                        }`}
                      >
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 shadow-sm ${
                          isOnShift
                            ? `bg-gradient-to-br ${cfg.color} text-white`
                            : "bg-slate-300 text-slate-500"
                        }`}>
                          {selecting === member.id ? (
                            <span className="animate-spin text-base">&#8635;</span>
                          ) : initials}
                        </div>
                        <div className="min-w-0">
                          <p className={`text-sm font-medium truncate leading-tight ${isOnShift ? "text-slate-800" : "text-slate-400"}`}>{member.name}</p>
                          {member.phone && (
                            <p className="text-xs text-slate-400 truncate">{member.phone}</p>
                          )}
                          {!isOnShift && (
                            <p className="text-[10px] text-slate-400 font-medium">Not on shift</p>
                          )}
                        </div>
                        {isOnShift && (
                          (member as any).hasPassword ? (
                            <Lock className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 ml-auto shrink-0 transition-colors" />
                          ) : (
                            <LogIn className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 ml-auto shrink-0 transition-colors" />
                          )
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {passwordPrompt && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPasswordPrompt(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${ROLE_CONFIG[passwordPrompt.member.role as keyof typeof ROLE_CONFIG]?.color ?? "from-slate-500 to-slate-600"} flex items-center justify-center text-white text-sm font-bold`}>
                  {passwordPrompt.member.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                </div>
                <div>
                  <p className="font-semibold text-slate-800">{passwordPrompt.member.name}</p>
                  <p className="text-xs text-slate-500 capitalize">{passwordPrompt.member.role}</p>
                </div>
              </div>
              <button onClick={() => setPasswordPrompt(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePasswordSubmit}>
              <label className="text-sm font-medium text-slate-700 mb-2 block">
                Enter your first name and last name initial
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setPasswordError(false); }}
                  autoFocus
                  className={`w-full px-4 py-3 rounded-xl border ${passwordError ? "border-red-300 bg-red-50" : "border-slate-200"} text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 pr-10`}
                  placeholder="e.g. John S"
                />
              </div>
              {passwordError && (
                <p className="text-red-500 text-xs mt-2 font-medium">Incorrect name. Please try again.</p>
              )}
              <button
                type="submit"
                disabled={verifying || !password}
                className="w-full mt-4 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {verifying ? (
                  <span className="animate-spin">&#8635;</span>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    Sign In
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      <p className="text-slate-600 text-xs mt-8 relative z-10">Marvol Facility Services · MCO Airport · Internal System</p>
    </div>
  );
}
