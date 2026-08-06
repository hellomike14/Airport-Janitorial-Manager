import React, { useState, useMemo, useRef, useEffect } from "react";
import { useListStaff, useListAssignments } from "@workspace/api-client-react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { useAuth, UserRole } from "@/contexts/AuthContext";
import { Shield, Users, User, LogIn, ClipboardCheck, Lock, X } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type PinMode = "enter" | "set" | "confirm";


export default function Login() {
  const { t } = useTranslation();
  const { data: staffList, isLoading } = useListStaff();
  const today = format(new Date(), "yyyy-MM-dd");
  const { data: todayAssignments } = useListAssignments({ date: today });
  const { login } = useAuth();
  const [selecting, setSelecting] = useState<number | null>(null);
  const [pinPrompt, setPinPrompt] = useState<{ member: NonNullable<typeof staffList>[number] } | null>(null);
  const [pinMode, setPinMode] = useState<PinMode>("enter");
  const [pinDigits, setPinDigits] = useState<string[]>(["", "", "", ""]);
  const [firstPin, setFirstPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const ROLE_CONFIG = {
    admin: {
      label: t("roles.administrator"),
      icon: Shield,
      color: "from-violet-600 to-indigo-600",
      bg: "bg-violet-50 border-violet-200",
      badge: "bg-violet-100 text-violet-700",
      description: t("login.roleDescriptions.admin"),
    },
    inspector: {
      label: t("roles.inspector"),
      icon: ClipboardCheck,
      color: "from-blue-600 to-cyan-500",
      bg: "bg-blue-50 border-blue-200",
      badge: "bg-blue-100 text-blue-700",
      description: t("login.roleDescriptions.inspector"),
    },
    supervisor: {
      label: t("roles.supervisor"),
      icon: Users,
      color: "from-emerald-600 to-teal-500",
      bg: "bg-emerald-50 border-emerald-200",
      badge: "bg-emerald-100 text-emerald-800",
      description: t("login.roleDescriptions.supervisor"),
    },
    staff: {
      label: t("roles.staff"),
      icon: User,
      color: "from-emerald-500 to-teal-500",
      bg: "bg-emerald-50 border-emerald-200",
      badge: "bg-emerald-100 text-emerald-700",
      description: t("login.roleDescriptions.staff"),
    },
  };

  const assignedStaffIds = useMemo(() => {
    return new Set((todayAssignments ?? []).map((a) => a.staffId));
  }, [todayAssignments]);

  useEffect(() => {
    if (pinPrompt && inputRefs.current[0]) {
      inputRefs.current[0]?.focus();
    }
  }, [pinPrompt, pinMode]);

  const resetPinState = () => {
    setPinDigits(["", "", "", ""]);
    setPinError(null);
    setFirstPin("");
  };

  const handleLogin = (member: NonNullable<typeof staffList>[number]) => {
    // Every role authenticates with a personal PIN (set on first login).
    // This is what establishes the server-side actor session used by
    // identity-sensitive features like Messages.
    setPinPrompt({ member });
    const hasPin = (member as any).hasPin;
    setPinMode(hasPin ? "enter" : "set");
    resetPinState();
  };

  const completeLogin = (member: NonNullable<typeof staffList>[number]) => {
    setPinPrompt(null);
    setSelecting(member.id);
    login({
      id: member.id,
      name: member.name,
      role: member.role as UserRole,
      phone: member.phone,
      email: member.email,
    });
  };

  const handlePinComplete = async (pin: string) => {
    if (!pinPrompt) return;

    if (pinMode === "enter") {
      setVerifying(true);
      setPinError(null);
      try {
        const res = await fetch(`${BASE_URL}/api/staff/verify-pin`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staffId: pinPrompt.member.id, pin }),
        });
        if (res.ok) {
          completeLogin(pinPrompt.member);
        } else {
          setPinError(t("login.incorrectPin"));
          setPinDigits(["", "", "", ""]);
          setTimeout(() => inputRefs.current[0]?.focus(), 50);
        }
      } catch {
        setPinError(t("login.incorrectPin"));
        setPinDigits(["", "", "", ""]);
        setTimeout(() => inputRefs.current[0]?.focus(), 50);
      } finally {
        setVerifying(false);
      }
    } else if (pinMode === "set") {
      setFirstPin(pin);
      setPinMode("confirm");
      setPinDigits(["", "", "", ""]);
      setPinError(null);
    } else if (pinMode === "confirm") {
      if (pin !== firstPin) {
        setPinError(t("layout.pinsNoMatch"));
        setPinMode("set");
        setFirstPin("");
        setPinDigits(["", "", "", ""]);
        setTimeout(() => inputRefs.current[0]?.focus(), 50);
        return;
      }
      setVerifying(true);
      setPinError(null);
      try {
        const res = await fetch(`${BASE_URL}/api/staff/set-pin`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staffId: pinPrompt.member.id, pin }),
        });
        if (res.ok) {
          completeLogin(pinPrompt.member);
        } else if (res.status === 403) {
          setPinError(t("login.askAdminForPin"));
          setPinMode("set");
          setFirstPin("");
          setPinDigits(["", "", "", ""]);
        } else {
          setPinError(t("layout.failedSetPin"));
          setPinMode("set");
          setFirstPin("");
          setPinDigits(["", "", "", ""]);
          setTimeout(() => inputRefs.current[0]?.focus(), 50);
        }
      } catch {
        setPinError(t("layout.failedSetPin"));
        setPinMode("set");
        setFirstPin("");
        setPinDigits(["", "", "", ""]);
        setTimeout(() => inputRefs.current[0]?.focus(), 50);
      } finally {
        setVerifying(false);
      }
    }
  };

  const handleDigitChange = (index: number, value: string) => {
    if (verifying) return;
    const digit = value.replace(/\D/g, "").slice(-1);
    const newDigits = [...pinDigits];
    newDigits[index] = digit;
    setPinDigits(newDigits);
    setPinError(null);

    if (digit && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }

    if (digit && index === 3 && newDigits.every((d) => d !== "")) {
      handlePinComplete(newDigits.join(""));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !pinDigits[index] && index > 0) {
      const newDigits = [...pinDigits];
      newDigits[index - 1] = "";
      setPinDigits(newDigits);
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
    if (pasted.length === 4) {
      const newDigits = pasted.split("");
      setPinDigits(newDigits);
      inputRefs.current[3]?.focus();
      handlePinComplete(pasted);
    }
  };

  const getPinTitle = () => {
    if (pinMode === "set") return t("login.setYourPin", "Set your PIN");
    if (pinMode === "confirm") return t("layout.confirmNewPin");
    return t("login.enterPin");
  };

  const getPinSubtitle = () => {
    if (pinMode === "set") return t("login.createPinSubtitle", "Create a 4-digit PIN for future logins");
    if (pinMode === "confirm") return t("login.confirmPinSubtitle", "Re-enter your PIN to confirm");
    return t("login.enterPinSubtitle", "Enter your 4-digit PIN");
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

      <div className="absolute top-4 right-4 z-20">
        <LanguageSwitcher variant="login" />
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
        <p className="text-emerald-300 mt-1 text-sm font-medium tracking-wide uppercase">{t("login.mcoAirport")}</p>
        <p className="text-slate-400 mt-3 text-sm">{t("login.selectProfile")}</p>
      </div>

      {isLoading ? (
        <div className="text-emerald-300 text-sm">{t("login.loadingStaff")}</div>
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
                        {members.length} {members.length === 1 ? t("common.user") : t("common.users")}
                      </span>
                      {role !== "staff" && (
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <Lock className="w-3 h-3" /> {t("login.pinRequired")}
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
                            <p className="text-[10px] text-slate-400 font-medium">{t("login.notOnShift")}</p>
                          )}
                        </div>
                        {isOnShift && (
                          role !== "staff" ? (
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

      {pinPrompt && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setPinPrompt(null); resetPinState(); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${ROLE_CONFIG[pinPrompt.member.role as keyof typeof ROLE_CONFIG]?.color ?? "from-slate-500 to-slate-600"} flex items-center justify-center text-white text-sm font-bold`}>
                  {pinPrompt.member.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                </div>
                <div>
                  <p className="font-semibold text-slate-800">{pinPrompt.member.name}</p>
                  <p className="text-xs text-slate-500 capitalize">{pinPrompt.member.role}</p>
                </div>
              </div>
              <button onClick={() => { setPinPrompt(null); resetPinState(); }} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-center mb-6">
              <p className="font-semibold text-slate-800 text-lg">{getPinTitle()}</p>
              <p className="text-sm text-slate-500 mt-1">{getPinSubtitle()}</p>
            </div>

            <div className="flex justify-center gap-3 mb-4" onPaste={handlePaste}>
              {pinDigits.map((digit, i) => (
                <input
                  key={`${pinMode}-${i}`}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigitChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  disabled={verifying}
                  className={`w-14 h-16 text-center text-2xl font-bold rounded-xl border-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all ${
                    pinError ? "border-red-300 bg-red-50" : digit ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"
                  } disabled:opacity-50`}
                  autoFocus={i === 0}
                />
              ))}
            </div>

            {pinError && (
              <p className="text-red-500 text-xs text-center font-medium mb-3">{pinError}</p>
            )}

            {verifying && (
              <div className="flex items-center justify-center gap-2 text-emerald-600 text-sm">
                <span className="animate-spin">&#8635;</span>
                <span>{pinMode === "enter" ? t("layout.verifying") : t("layout.settingPin")}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <p className="text-slate-600 text-xs mt-8 relative z-10">{t("login.footer")}</p>
    </div>
  );
}
