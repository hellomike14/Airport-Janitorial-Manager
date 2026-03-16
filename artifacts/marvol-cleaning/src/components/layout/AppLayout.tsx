import React, { useState } from "react";
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
  Search,
  ChevronDown
} from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";

interface NavItemProps {
  href: string;
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  onClick?: () => void;
}

const NavItem = ({ href, icon: Icon, label, isActive, onClick }: NavItemProps) => (
  <Link href={href} onClick={onClick} className={
    `flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group relative overflow-hidden
    ${isActive 
      ? 'bg-accent text-accent-foreground shadow-md shadow-accent/20 font-medium' 
      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
    }`
  }>
    <Icon className={`w-5 h-5 transition-transform duration-200 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`} />
    <span>{label}</span>
    {isActive && (
      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-white rounded-r-full" />
    )}
  </Link>
);

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    { href: "/", icon: LayoutDashboard, label: "Dashboard" },
    { href: "/areas", icon: Map, label: "Cleaning Areas" },
    { href: "/assignments", icon: ClipboardList, label: "Assignments" },
    { href: "/staff", icon: Users, label: "Staff Directory" },
    { href: "/issues", icon: AlertTriangle, label: "Issue Tracker" },
  ];

  // Determine active route
  const getIsActive = (href: string) => {
    if (href === "/" && location !== "/") return false;
    return location.startsWith(href);
  };

  const closeMobile = () => setMobileOpen(false);

  return (
    <div className="min-h-screen bg-background flex w-full font-sans">
      {/* Mobile Sidebar Overlay */}
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
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo Area */}
        <div className="h-20 flex items-center px-6 border-b border-sidebar-border/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-blue-400 flex items-center justify-center shadow-lg shadow-accent/20">
              <span className="text-white font-display font-bold text-xl">M</span>
            </div>
            <div>
              <h1 className="font-display font-bold text-lg leading-tight tracking-tight">Marvol Facility</h1>
              <p className="text-xs text-sidebar-foreground/60 uppercase tracking-wider font-semibold">MCO Operations</p>
            </div>
          </div>
          <button className="ml-auto lg:hidden text-sidebar-foreground/50 hover:text-white" onClick={closeMobile}>
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-6 px-4 space-y-2">
          <div className="px-2 mb-2 text-xs font-semibold text-sidebar-foreground/40 uppercase tracking-wider">
            Management Menu
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

        {/* User Profile Snippet */}
        <div className="p-4 border-t border-sidebar-border/50 m-4 rounded-2xl bg-sidebar-accent/50 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center border-2 border-white/10">
              <span className="font-medium text-sm">SA</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">System Admin</p>
              <p className="text-xs text-sidebar-foreground/60 truncate">Supervisor Role</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Top Header */}
        <header className="h-20 bg-white/80 backdrop-blur-xl border-b border-border flex items-center justify-between px-4 sm:px-8 shrink-0 z-30 sticky top-0 shadow-sm shadow-slate-200/20">
          <div className="flex items-center gap-4">
            <button 
              className="lg:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="w-6 h-6" />
            </button>
            <div className="hidden sm:flex items-center text-sm font-medium text-slate-500 bg-slate-100 px-4 py-2 rounded-full">
              {format(new Date(), "EEEE, MMMM do, yyyy")}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <div className="relative hidden md:block">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search areas, tasks..." 
                className="pl-10 pr-4 py-2 w-64 rounded-full bg-slate-100 border-none focus:ring-2 focus:ring-accent/20 text-sm outline-none transition-all focus:w-72"
              />
            </div>
            
            <Button variant="ghost" size="icon" className="relative rounded-full hover:bg-slate-100">
              <Bell className="w-5 h-5 text-slate-600" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-destructive rounded-full border-2 border-white"></span>
            </Button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-8 relative">
          {/* Subtle Background Glow */}
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl pointer-events-none -z-10" />
          <div className="max-w-7xl mx-auto animate-fade-in-up">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
