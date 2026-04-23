import React, { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Map,
  Users,
  ClipboardList,
  AlertTriangle,
  Menu,
  X,
  Bell,
  LogOut,
  Shield,
  ChevronDown,
  User,
  CheckSquare,
  ListChecks,
  CheckCircle2,
  AlertOctagon,
  Layers,
  FileText,
  ClipboardCheck,
  Navigation,
  Lock,
  Send,
  Megaphone,
  Calendar,
  Camera,
  BarChart3,
  Star,
} from "lucide-react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { getDateLocale } from "@/i18n/dateLocale";
import { useLocationTracker } from "@/hooks/useLocationTracker";
import { Button } from "@/components/ui/button";
import { useAuth, ViewMode } from "@/contexts/AuthContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
  useListNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useListStaff,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface NavItemProps {
  href: string;
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  onClick?: () => void;
}

const NavItem = ({ href, icon: Icon, label, isActive, onClick }: NavItemProps) => (
  <Link
    href={href}
    onClick={onClick}
    className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group relative overflow-hidden
    ${isActive
      ? "bg-accent text-accent-foreground shadow-md shadow-accent/20 font-medium"
      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
    }`}
  >
    <Icon className={`w-5 h-5 transition-transform duration-200 ${isActive ? "scale-110" : "group-hover:scale-110"}`} />
    <span>{label}</span>
    {isActive && (
      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-white rounded-r-full" />
    )}
  </Link>
);

function useNavConfig() {
  const { t } = useTranslation();

  const VIEW_MODES: { value: ViewMode; label: string; icon: React.ElementType; color: string }[] = [
    { value: "admin", label: t("roles.admin"), icon: Shield, color: "text-violet-400" },
    { value: "inspector", label: t("roles.inspector"), icon: ClipboardCheck, color: "text-blue-400" },
    { value: "supervisor", label: t("roles.supervisor"), icon: Users, color: "text-emerald-400" },
    { value: "staff", label: t("roles.staff"), icon: User, color: "text-emerald-400" },
  ];

  const NAV_BY_ROLE: Record<ViewMode, { href: string; icon: React.ElementType; label: string }[]> = {
    admin: [
      { href: "/", icon: LayoutDashboard, label: t("nav.dashboard") },
      { href: "/tasks", icon: ListChecks, label: t("nav.taskManagement") },
      { href: "/task-types", icon: Layers, label: t("nav.taskTypeInventory") },
      { href: "/areas", icon: Map, label: t("nav.cleaningAreas") },
      { href: "/assignments", icon: ClipboardList, label: t("nav.assignments") },
      { href: "/staff", icon: Users, label: t("nav.staffDirectory") },
      { href: "/issues", icon: AlertTriangle, label: t("nav.inspectorSpecialAssignments") },
      { href: "/report", icon: FileText, label: t("nav.inspectorReport") },
      { href: "/gps-tracking", icon: Navigation, label: t("nav.gpsTracking") },
      { href: "/employee-portal", icon: Calendar, label: t("nav.employeePortal") },
      { href: "/photo-share", icon: Camera, label: t("nav.photoShare") },
      { href: "/weekly-report", icon: BarChart3, label: t("nav.weeklyReport") },
      { href: "/special-requests", icon: Star, label: t("nav.specialRequests") },
    ],
    supervisor: [
      { href: "/", icon: LayoutDashboard, label: t("nav.dashboard") },
      { href: "/tasks", icon: ListChecks, label: t("nav.taskManagement") },
      { href: "/areas", icon: Map, label: t("nav.cleaningAreas") },
      { href: "/assignments", icon: ClipboardList, label: t("nav.assignments") },
      { href: "/issues", icon: AlertTriangle, label: t("nav.inspectorSpecialAssignments") },
      { href: "/report", icon: FileText, label: t("nav.inspectorReport") },
      { href: "/employee-portal", icon: Calendar, label: t("nav.employeePortal") },
      { href: "/photo-share", icon: Camera, label: t("nav.photoShare") },
      { href: "/special-requests", icon: Star, label: t("nav.specialRequests") },
    ],
    inspector: [
      { href: "/issues", icon: AlertTriangle, label: t("nav.openIssues") },
      { href: "/completed-jobs", icon: CheckCircle2, label: t("nav.completedTasks") },
      { href: "/photo-share", icon: Camera, label: t("nav.photoShare") },
      { href: "/special-requests", icon: Star, label: t("nav.specialRequests") },
    ],
    staff: [
      { href: "/my-tasks", icon: CheckSquare, label: t("nav.myTasks") },
      { href: "/issues", icon: AlertTriangle, label: t("nav.myIssues") },
      { href: "/employee-portal", icon: Calendar, label: t("nav.mySchedule") },
      { href: "/photo-share", icon: Camera, label: t("nav.photoShare") },
      { href: "/special-requests", icon: Star, label: t("nav.specialRequests") },
    ],
  };

  const ROLE_BADGE: Record<ViewMode, { label: string; cls: string }> = {
    admin: { label: t("roles.admin"), cls: "bg-violet-500/20 text-violet-300 border border-violet-500/30" },
    inspector: { label: t("roles.inspector"), cls: "bg-blue-500/20 text-blue-300 border border-blue-500/30" },
    supervisor: { label: t("roles.supervisor"), cls: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" },
    staff: { label: t("roles.staff"), cls: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" },
  };

  return { VIEW_MODES, NAV_BY_ROLE, ROLE_BADGE };
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

let audioUnlocked = false;
let audioCtx: AudioContext | null = null;
const regularSound = new Audio(`${BASE}/sounds/notification.wav`);
const urgentSound = new Audio(`${BASE}/sounds/notification-urgent.wav`);
regularSound.preload = "auto";
urgentSound.preload = "auto";

function unlockAudio() {
  if (audioUnlocked) return;
  try {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    regularSound.volume = 0.01;
    regularSound.play().then(() => {
      regularSound.pause();
      regularSound.currentTime = 0;
      regularSound.volume = 1;
    }).catch(() => { regularSound.volume = 1; });
    urgentSound.volume = 0.01;
    urgentSound.play().then(() => {
      urgentSound.pause();
      urgentSound.currentTime = 0;
      urgentSound.volume = 1;
    }).catch(() => { urgentSound.volume = 1; });
    audioUnlocked = true;
  } catch {}
}

if (typeof window !== "undefined") {
  const unlockHandler = () => {
    unlockAudio();
    document.removeEventListener("click", unlockHandler, true);
    document.removeEventListener("touchstart", unlockHandler, true);
    document.removeEventListener("keydown", unlockHandler, true);
  };
  document.addEventListener("click", unlockHandler, true);
  document.addEventListener("touchstart", unlockHandler, true);
  document.addEventListener("keydown", unlockHandler, true);
}

function playNotificationSound(urgent: boolean = false) {
  try {
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    const sound = urgent ? urgentSound : regularSound;
    sound.currentTime = 0;
    sound.play().catch((err) => {
      console.warn("Notification sound blocked:", err.message);
    });
  } catch (err) {
    console.warn("Notification sound error:", err);
  }
}

function vibrateDevice(urgent: boolean = false) {
  try {
    if (navigator.vibrate) {
      if (urgent) {
        navigator.vibrate([200, 100, 200, 100, 300]);
      } else {
        navigator.vibrate([150, 50, 150]);
      }
    }
  } catch {}
}

function NotificationBell({ staffId }: { staffId: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const prevUnreadIdsRef = useRef<Set<number>>(new Set());
  const initialLoadRef = useRef(true);

  const { data: notifications = [] } = useListNotifications(
    { staffId },
    { query: { refetchInterval: 15000 } }
  );

  const markRead = useMarkNotificationRead({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/notifications"] }) },
  });
  const markAllRead = useMarkAllNotificationsRead({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/notifications"] }) },
  });

  const unread = notifications.filter((n) => !n.isRead);
  const unreadCount = unread.length;

  useEffect(() => {
    const currentUnreadIds = new Set(unread.map((n) => n.id));
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      prevUnreadIdsRef.current = currentUnreadIds;
      return;
    }

    const newNotifications = unread.filter((n) => !prevUnreadIdsRef.current.has(n.id));
    if (newNotifications.length > 0) {
      const URGENT_TYPES = new Set([
        "inspector_to_supervisor", "supervisor_to_inspector",
        "new_issue", "issue_assigned", "issue_completed",
        "task_completed", "direct_alert", "photo_shared",
      ]);
      const hasUrgent = newNotifications.some((n) => URGENT_TYPES.has(n.type));
      playNotificationSound(hasUrgent);
      vibrateDevice(hasUrgent);
    }
    prevUnreadIdsRef.current = currentUnreadIds;
  }, [unread]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpen = () => {
    setOpen((v) => !v);
  };

  const handleMarkAllRead = () => {
    markAllRead.mutate({ data: { staffId } });
  };

  const typeIcon = (type: string) => {
    if (type === "issue_assigned") return <User className="w-3.5 h-3.5 text-blue-500 shrink-0" />;
    if (type === "issue_completed") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
    if (type === "task_completed") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
    if (type === "inspector_to_supervisor") return <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
    if (type === "supervisor_to_inspector") return <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />;
    if (type === "direct_alert") return <Megaphone className="w-3.5 h-3.5 text-orange-500 shrink-0" />;
    if (type === "photo_shared") return <Camera className="w-3.5 h-3.5 text-blue-500 shrink-0" />;
    return <AlertOctagon className="w-3.5 h-3.5 text-rose-500 shrink-0" />;
  };

  const URGENT_TYPES_BADGE = new Set([
    "inspector_to_supervisor", "supervisor_to_inspector",
    "new_issue", "issue_assigned", "issue_completed",
    "task_completed", "direct_alert", "photo_shared",
  ]);
  const hasUrgentUnread = unread.some((n) => URGENT_TYPES_BADGE.has(n.type));

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        className={`relative rounded-full hover:bg-slate-100 ${hasUrgentUnread ? "animate-pulse" : ""}`}
        onClick={handleOpen}
      >
        <Bell className={`w-5 h-5 ${hasUrgentUnread ? "text-amber-500" : "text-slate-600"}`} />
        {unreadCount > 0 && (
          <span className={`absolute top-1 right-1 min-w-[16px] h-4 rounded-full border-2 border-white text-white text-[9px] font-bold flex items-center justify-center px-0.5 ${hasUrgentUnread ? "bg-amber-500" : "bg-rose-500"}`}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl border border-slate-200 shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="font-bold text-slate-800 text-sm">{t("layout.notifications")}</span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
              >
                {t("layout.markAllRead")}
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
            {notifications.length === 0 && (
              <div className="p-6 text-center text-slate-400 text-sm">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                {t("layout.noNotifications")}
              </div>
            )}
            {notifications.slice(0, 20).map((n) => (
              <button
                key={n.id}
                className={`w-full text-left px-4 py-3 flex gap-3 items-start transition-colors hover:bg-slate-50 ${!n.isRead ? "bg-blue-50/60" : ""}`}
                onClick={() => {
                  if (!n.isRead) markRead.mutate({ id: n.id });
                  setOpen(false);
                }}
              >
                <div className="mt-0.5">{typeIcon(n.type)}</div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs leading-relaxed ${!n.isRead ? "text-slate-800 font-medium" : "text-slate-600"}`}>
                    {n.message}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {format(new Date(n.createdAt), "MMM d, h:mm a")}
                  </p>
                </div>
                {!n.isRead && (
                  <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function SetPinModal({ staffId, hasExistingPin, onClose }: { staffId: number; hasExistingPin: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [currentPinDigits, setCurrentPinDigits] = useState<string[]>(["", "", "", ""]);
  const [pinDigits, setPinDigits] = useState<string[]>(["", "", "", ""]);
  const [confirmDigits, setConfirmDigits] = useState<string[]>(["", "", "", ""]);
  const [step, setStep] = useState<"current" | "new" | "confirm">(hasExistingPin ? "current" : "new");
  const [verifiedCurrentPin, setVerifiedCurrentPin] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    setTimeout(() => inputRefs.current[0]?.focus(), 50);
  }, [step]);

  const getStepDigits = (): [string[], React.Dispatch<React.SetStateAction<string[]>>] => {
    if (step === "current") return [currentPinDigits, setCurrentPinDigits];
    if (step === "new") return [pinDigits, setPinDigits];
    return [confirmDigits, setConfirmDigits];
  };

  const handleDigitChange = (index: number, value: string) => {
    if (saving) return;
    const [digits, setDigits] = getStepDigits();
    const digit = value.replace(/\D/g, "").slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);
    setError("");
    if (digit && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }
    if (digit && index === 3 && newDigits.every((d) => d !== "")) {
      const pin = newDigits.join("");
      if (step === "current") {
        verifyCurrentPin(pin);
      } else if (step === "new") {
        setStep("confirm");
        setConfirmDigits(["", "", "", ""]);
      } else {
        const newPin = pinDigits.join("");
        if (pin !== newPin) {
          setError(t("layout.pinsNoMatch"));
          setStep("new");
          setPinDigits(["", "", "", ""]);
          setConfirmDigits(["", "", "", ""]);
          return;
        }
        submitPin(pin);
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    const [digits, setDigits] = getStepDigits();
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      const newDigits = [...digits];
      newDigits[index - 1] = "";
      setDigits(newDigits);
      inputRefs.current[index - 1]?.focus();
    }
  };

  const verifyCurrentPin = async (pin: string) => {
    setSaving(true);
    try {
      const res = await fetch(`${BASE_URL}/api/staff/verify-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId, pin }),
      });
      if (res.ok) {
        setVerifiedCurrentPin(pin);
        setStep("new");
        setPinDigits(["", "", "", ""]);
      } else {
        setError(t("layout.incorrectCurrentPin"));
        setCurrentPinDigits(["", "", "", ""]);
        setTimeout(() => inputRefs.current[0]?.focus(), 50);
      }
    } catch {
      setError(t("common.networkError"));
      setCurrentPinDigits(["", "", "", ""]);
    } finally {
      setSaving(false);
    }
  };

  const submitPin = async (pin: string) => {
    setSaving(true);
    try {
      const res = await fetch(`${BASE_URL}/api/staff/set-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId, pin, ...(verifiedCurrentPin ? { currentPin: verifiedCurrentPin } : {}) }),
      });
      if (res.ok) {
        setSuccess(true);
        setTimeout(onClose, 1500);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || t("layout.failedSetPin"));
        setStep("new");
        setPinDigits(["", "", "", ""]);
        setConfirmDigits(["", "", "", ""]);
      }
    } catch {
      setError(t("common.networkError"));
      setStep("new");
      setPinDigits(["", "", "", ""]);
      setConfirmDigits(["", "", "", ""]);
    } finally {
      setSaving(false);
    }
  };

  const [currentDigits] = getStepDigits();
  const stepLabel = step === "current" ? t("layout.enterCurrentPin") : step === "new" ? t("layout.enterNewPin") : t("layout.confirmNewPin");

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-700 flex items-center justify-center">
              <Lock className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-semibold text-slate-800">{hasExistingPin ? t("layout.changePin") : t("layout.setPin")}</p>
              <p className="text-xs text-slate-500">{stepLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {success ? (
          <div className="text-center py-6">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <p className="font-semibold text-slate-800">{hasExistingPin ? t("layout.pinUpdatedSuccess") : t("layout.pinSetSuccess")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center gap-3">
              {currentDigits.map((digit, i) => (
                <input
                  key={`${step}-${i}`}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigitChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  disabled={saving}
                  className={`w-14 h-16 text-center text-2xl font-bold rounded-xl border-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all ${
                    error ? "border-red-300 bg-red-50" : digit ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"
                  } disabled:opacity-50`}
                />
              ))}
            </div>
            {error && <p className="text-red-500 text-xs text-center font-medium">{error}</p>}
            {saving && (
              <div className="flex items-center justify-center gap-2 text-emerald-600 text-sm">
                <span className="animate-spin">&#8635;</span>
                <span>{step === "current" ? t("layout.verifying") : t("layout.settingPin")}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SendAlertModal({ staffId, staffRole, onClose }: { staffId: number; staffRole: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [targetRole, setTargetRole] = useState<"supervisor" | "staff" | "all">("supervisor");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentCount, setSentCount] = useState(0);

  const canSendToStaff = staffRole === "inspector" || staffRole === "admin";

  const handleSend = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`${BASE_URL}/api/notifications/send-alert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderId: staffId, message: message.trim(), targetRole }),
      });
      if (res.ok) {
        const data = await res.json();
        setSentCount(data.sent);
        setSent(true);
        setTimeout(() => onClose(), 1500);
      }
    } catch {}
    setSending(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-white">
              <Megaphone className="w-5 h-5" />
            </div>
            <div>
              <p className="font-semibold text-slate-800">{t("alerts.sendAlert")}</p>
              <p className="text-xs text-slate-500">{t("alerts.sendAlertDesc")}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {sent ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            </div>
            <p className="font-semibold text-slate-800">{t("alerts.alertSent")}</p>
            <p className="text-sm text-slate-500 mt-1">{t("alerts.sentTo", { count: sentCount })}</p>
          </div>
        ) : (
          <>
            {canSendToStaff && (
              <div className="mb-4">
                <label className="text-sm font-medium text-slate-700 mb-2 block">{t("alerts.sendTo")}</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setTargetRole("supervisor")}
                    className={`flex-1 py-2 px-3 rounded-xl text-sm font-medium border transition-colors ${
                      targetRole === "supervisor"
                        ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {t("alerts.supervisors")}
                  </button>
                  <button
                    onClick={() => setTargetRole("staff")}
                    className={`flex-1 py-2 px-3 rounded-xl text-sm font-medium border transition-colors ${
                      targetRole === "staff"
                        ? "bg-blue-50 border-blue-300 text-blue-700"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {t("alerts.staffMembers")}
                  </button>
                  <button
                    onClick={() => setTargetRole("all")}
                    className={`flex-1 py-2 px-3 rounded-xl text-sm font-medium border transition-colors ${
                      targetRole === "all"
                        ? "bg-orange-50 border-orange-300 text-orange-700"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {t("alerts.everyone")}
                  </button>
                </div>
              </div>
            )}

            <div className="mb-4">
              <label className="text-sm font-medium text-slate-700 mb-2 block">{t("alerts.message")}</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("alerts.messagePlaceholder")}
                maxLength={500}
                rows={3}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm resize-none"
                autoFocus
              />
              <p className="text-xs text-slate-400 mt-1 text-right">{message.length}/500</p>
            </div>

            <button
              onClick={handleSend}
              disabled={sending || !message.trim()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {sending ? (
                <span className="animate-spin text-lg">&#8635;</span>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  {t("alerts.sendNow")}
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);
  const [showSetPin, setShowSetPin] = useState(false);
  const [showSendAlert, setShowSendAlert] = useState(false);
  const { currentUser, viewMode, setViewMode, logout } = useAuth();
  const { data: staffList } = useListStaff();
  const currentStaffData = staffList?.find((s) => s.id === currentUser?.id);
  const hasExistingPin = !!(currentStaffData as any)?.hasPin;

  const { VIEW_MODES, NAV_BY_ROLE, ROLE_BADGE } = useNavConfig();

  useLocationTracker();

  const navItems = NAV_BY_ROLE[viewMode];
  const badge = ROLE_BADGE[viewMode];
  const canSwitchView = currentUser?.role === "admin";

  const getIsActive = (href: string) => {
    if (href === "/" && location !== "/") return false;
    return location.startsWith(href);
  };

  const closeMobile = () => setMobileOpen(false);

  const initials = currentUser?.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() ?? "??";

  const dateLocale = getDateLocale(i18n.language);

  return (
    <div className="min-h-screen bg-background flex w-full font-sans">
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={closeMobile}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50
        w-[280px] bg-sidebar text-sidebar-foreground flex flex-col
        transition-transform duration-300 ease-out shadow-2xl lg:shadow-none
        ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `}>
        {/* Logo */}
        <div className="h-20 flex items-center px-5 border-b border-sidebar-border/50 gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="bg-white/95 rounded-xl px-3 py-1.5 shadow-sm">
              <img
                src={`${import.meta.env.BASE_URL}logo.png`}
                alt="Marvol Enterprises"
                className="h-6 object-contain"
              />
            </div>
            <img
              src={`${import.meta.env.BASE_URL}logo-mark.png`}
              alt="Marvol Facility Services"
              className="w-10 h-10 object-contain shrink-0"
            />
          </div>
          <button className="ml-auto lg:hidden text-sidebar-foreground/50 hover:text-white shrink-0" onClick={closeMobile}>
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-6 px-4 space-y-2">
          <div className="px-2 mb-2 text-xs font-semibold text-sidebar-foreground/40 uppercase tracking-wider">
            {viewMode === "staff" ? t("nav.myWork") : t("nav.managementMenu")}
          </div>
          {navItems.map((item) => (
            <NavItem
              key={item.href}
              {...item}
              isActive={getIsActive(item.href)}
              onClick={closeMobile}
            />
          ))}
        </div>

        {/* Language Switcher */}
        <div className="px-4 pb-2">
          <LanguageSwitcher variant="sidebar" />
        </div>

        {/* User Profile */}
        <div className="p-4 border-t border-sidebar-border/50 m-4 rounded-2xl bg-sidebar-accent/50 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center border-2 border-white/10 text-sm font-bold shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{currentUser?.name ?? t("issuePdf.unknown")}</p>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                {badge.label}
              </span>
            </div>
          </div>
          <button
            onClick={logout}
            className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-300 hover:text-red-200 transition-colors"
            title={t("layout.logout")}
          >
            <LogOut className="w-3.5 h-3.5" />
            {t("layout.logout")}
          </button>
          {currentUser?.role !== "staff" && (
            <button
              onClick={() => setShowSetPin(true)}
              className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-sidebar-accent/80 hover:bg-sidebar-accent text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors"
            >
              <Lock className="w-3.5 h-3.5" />
              {hasExistingPin ? t("layout.changePin") : t("layout.setPin")}
            </button>
          )}
        </div>
      </aside>

      {showSetPin && currentUser && (
        <SetPinModal
          staffId={currentUser.id}
          hasExistingPin={hasExistingPin}
          onClose={() => setShowSetPin(false)}
        />
      )}

      {showSendAlert && currentUser && (
        <SendAlertModal
          staffId={currentUser.id}
          staffRole={currentUser.role}
          onClose={() => setShowSendAlert(false)}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Top Header */}
        <header className="h-16 bg-white/80 backdrop-blur-xl border-b border-border flex items-center justify-between px-4 sm:px-8 shrink-0 z-30 sticky top-0 shadow-sm shadow-slate-200/20">
          <div className="flex items-center gap-4">
            <button
              className="lg:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 active:bg-slate-200 transition-colors touch-manipulation"
              onClick={() => setMobileOpen(true)}
              aria-label={t("layout.openMenu")}
            >
              <Menu className="w-6 h-6" />
            </button>
            <div className="hidden sm:flex items-center text-sm font-medium text-slate-500 bg-slate-100 px-4 py-2 rounded-full">
              {format(new Date(), "EEEE, MMMM do, yyyy", { locale: dateLocale })}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* View mode toggle — admin only */}
            {canSwitchView && (
              <div className="relative">
                <button
                  onClick={() => setViewDropdownOpen((v) => !v)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50 hover:bg-slate-100 text-sm font-medium text-slate-700 transition-colors"
                >
                  <span className="hidden sm:inline text-xs text-slate-500 mr-1">{t("layout.viewingAs")}</span>
                  {viewMode === "admin" && <Shield className="w-4 h-4 text-violet-500" />}
                  {viewMode === "supervisor" && <Users className="w-4 h-4 text-blue-500" />}
                  {viewMode === "staff" && <User className="w-4 h-4 text-emerald-500" />}
                  <span className="capitalize font-semibold">{viewMode}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {viewDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setViewDropdownOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 w-44 bg-white rounded-xl border border-slate-200 shadow-lg z-40 overflow-hidden">
                      <div className="px-3 py-2 border-b border-slate-100 text-xs text-slate-500 font-medium">{t("layout.switchView")}</div>
                      {VIEW_MODES.map((vm) => (
                        <button
                          key={vm.value}
                          onClick={() => { setViewMode(vm.value); setViewDropdownOpen(false); }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors hover:bg-slate-50 ${viewMode === vm.value ? "bg-slate-50 font-semibold" : ""}`}
                        >
                          <vm.icon className={`w-4 h-4 ${vm.color}`} />
                          <span>{vm.label} {t("layout.view")}</span>
                          {viewMode === vm.value && <span className="ml-auto text-blue-500">✓</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {currentUser && (
              <Button
                variant="ghost"
                size="icon"
                className="relative rounded-full hover:bg-orange-50 text-slate-600 hover:text-orange-500"
                onClick={() => setShowSendAlert(true)}
                title={t("alerts.sendAlert")}
              >
                <Megaphone className="w-5 h-5" />
              </Button>
            )}
            {currentUser && <NotificationBell staffId={currentUser.id} />}
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-8 relative">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl pointer-events-none -z-10" />
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
