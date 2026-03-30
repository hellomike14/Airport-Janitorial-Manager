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
  Eye,
  EyeOff,
} from "lucide-react";
import { format } from "date-fns";
import { useLocationTracker } from "@/hooks/useLocationTracker";
import { Button } from "@/components/ui/button";
import { useAuth, ViewMode } from "@/contexts/AuthContext";
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

const VIEW_MODES: { value: ViewMode; label: string; icon: React.ElementType; color: string }[] = [
  { value: "admin", label: "Admin", icon: Shield, color: "text-violet-400" },
  { value: "inspector", label: "Inspector", icon: ClipboardCheck, color: "text-blue-400" },
  { value: "supervisor", label: "Supervisor", icon: Users, color: "text-emerald-400" },
  { value: "staff", label: "Staff", icon: User, color: "text-emerald-400" },
];

const NAV_BY_ROLE: Record<ViewMode, { href: string; icon: React.ElementType; label: string }[]> = {
  admin: [
    { href: "/", icon: LayoutDashboard, label: "Dashboard" },
    { href: "/tasks", icon: ListChecks, label: "Task Management" },
    { href: "/task-types", icon: Layers, label: "Task Type Inventory" },
    { href: "/areas", icon: Map, label: "Cleaning Areas" },
    { href: "/assignments", icon: ClipboardList, label: "Assignments" },
    { href: "/staff", icon: Users, label: "Staff Directory" },
    { href: "/issues", icon: AlertTriangle, label: "Inspector Special Assignments" },
    { href: "/report", icon: FileText, label: "Inspector Report" },
    { href: "/gps-tracking", icon: Navigation, label: "GPS Tracking" },
  ],
  supervisor: [
    { href: "/", icon: LayoutDashboard, label: "Dashboard" },
    { href: "/tasks", icon: ListChecks, label: "Task Management" },
    { href: "/areas", icon: Map, label: "Cleaning Areas" },
    { href: "/assignments", icon: ClipboardList, label: "Assignments" },
    { href: "/issues", icon: AlertTriangle, label: "Inspector Special Assignments" },
    { href: "/report", icon: FileText, label: "Inspector Report" },
  ],
  inspector: [
    { href: "/issues", icon: AlertTriangle, label: "Open Issues" },
    { href: "/completed-jobs", icon: CheckCircle2, label: "Completed Tasks" },
  ],
  staff: [
    { href: "/my-tasks", icon: CheckSquare, label: "My Tasks" },
    { href: "/issues", icon: AlertTriangle, label: "My Issues" },
  ],
};

const ROLE_BADGE: Record<ViewMode, { label: string; cls: string }> = {
  admin: { label: "Admin", cls: "bg-violet-500/20 text-violet-300 border border-violet-500/30" },
  inspector: { label: "Inspector", cls: "bg-blue-500/20 text-blue-300 border border-blue-500/30" },
  supervisor: { label: "Supervisor", cls: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" },
  staff: { label: "Staff", cls: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" },
};

function playNotificationSound(urgent: boolean = false) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;

    if (urgent) {
      [0, 0.15, 0.3].forEach((delay) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(880, now + delay);
        osc.frequency.setValueAtTime(1100, now + delay + 0.07);
        gain.gain.setValueAtTime(0.3, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.01, now + delay + 0.12);
        osc.start(now + delay);
        osc.stop(now + delay + 0.12);
      });
    } else {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.setValueAtTime(880, now + 0.1);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    }

    setTimeout(() => ctx.close(), 1000);
  } catch {}
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
      const hasUrgent = newNotifications.some(
        (n) => n.type === "inspector_to_supervisor" || n.type === "supervisor_to_inspector" || n.type === "new_issue" || n.type === "task_completed"
      );
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
    return <AlertOctagon className="w-3.5 h-3.5 text-rose-500 shrink-0" />;
  };

  const hasUrgentUnread = unread.some(
    (n) => n.type === "inspector_to_supervisor" || n.type === "supervisor_to_inspector" || n.type === "new_issue" || n.type === "task_completed"
  );

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
            <span className="font-bold text-slate-800 text-sm">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
            {notifications.length === 0 && (
              <div className="p-6 text-center text-slate-400 text-sm">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                No notifications yet
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

function SetPasswordModal({ staffId, hasExistingPassword, onClose }: { staffId: number; hasExistingPassword: boolean; onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 4) {
      setError("Password must be at least 4 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${BASE_URL}/api/staff/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId,
          password: newPassword,
          ...(hasExistingPassword ? { currentPassword } : {}),
        }),
      });
      if (res.ok) {
        setSuccess(true);
        setTimeout(onClose, 1500);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to set password");
      }
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-700 flex items-center justify-center">
              <Lock className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-semibold text-slate-800">{hasExistingPassword ? "Change Password" : "Set Password"}</p>
              <p className="text-xs text-slate-500">{hasExistingPassword ? "Update your login password" : "Create a password for secure login"}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {success ? (
          <div className="text-center py-6">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <p className="font-semibold text-slate-800">Password {hasExistingPassword ? "updated" : "set"} successfully!</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {hasExistingPassword && (
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">Current Password</label>
                <div className="relative">
                  <input
                    type={showCurrent ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 pr-10"
                    placeholder="Enter current password"
                  />
                  <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">New Password</label>
              <div className="relative">
                <input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setError(""); }}
                  autoFocus
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 pr-10"
                  placeholder="Create a password"
                />
                <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Re-enter password"
              />
            </div>
            {error && <p className="text-red-500 text-xs font-medium">{error}</p>}
            <button
              type="submit"
              disabled={saving || !newPassword || !confirmPassword}
              className="w-full py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <span className="animate-spin">&#8635;</span> : <><Lock className="w-4 h-4" /> {hasExistingPassword ? "Update Password" : "Set Password"}</>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);
  const [showSetPassword, setShowSetPassword] = useState(false);
  const { currentUser, viewMode, setViewMode, logout } = useAuth();
  const { data: staffList } = useListStaff();
  const currentStaffData = staffList?.find((s) => s.id === currentUser?.id);
  const hasExistingPassword = !!(currentStaffData as any)?.hasPassword;

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
            {viewMode === "staff" ? "My Work" : "Management Menu"}
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

        {/* User Profile */}
        <div className="p-4 border-t border-sidebar-border/50 m-4 rounded-2xl bg-sidebar-accent/50 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center border-2 border-white/10 text-sm font-bold shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{currentUser?.name ?? "Unknown"}</p>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                {badge.label}
              </span>
            </div>
            <button
              onClick={logout}
              className="text-sidebar-foreground/40 hover:text-red-400 transition-colors"
              title="Log out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
          {currentUser?.role === "staff" && (
            <button
              onClick={() => setShowSetPassword(true)}
              className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-sidebar-accent/80 hover:bg-sidebar-accent text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors"
            >
              <Lock className="w-3.5 h-3.5" />
              {hasExistingPassword ? "Change Password" : "Set Password"}
            </button>
          )}
        </div>
      </aside>

      {showSetPassword && currentUser && (
        <SetPasswordModal
          staffId={currentUser.id}
          hasExistingPassword={hasExistingPassword}
          onClose={() => setShowSetPassword(false)}
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
              aria-label="Open menu"
            >
              <Menu className="w-6 h-6" />
            </button>
            <div className="hidden sm:flex items-center text-sm font-medium text-slate-500 bg-slate-100 px-4 py-2 rounded-full">
              {format(new Date(), "EEEE, MMMM do, yyyy")}
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
                  <span className="hidden sm:inline text-xs text-slate-500 mr-1">Viewing as</span>
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
                      <div className="px-3 py-2 border-b border-slate-100 text-xs text-slate-500 font-medium">Switch View</div>
                      {VIEW_MODES.map((vm) => (
                        <button
                          key={vm.value}
                          onClick={() => { setViewMode(vm.value); setViewDropdownOpen(false); }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors hover:bg-slate-50 ${viewMode === vm.value ? "bg-slate-50 font-semibold" : ""}`}
                        >
                          <vm.icon className={`w-4 h-4 ${vm.color}`} />
                          <span>{vm.label} View</span>
                          {viewMode === vm.value && <span className="ml-auto text-blue-500">✓</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
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
