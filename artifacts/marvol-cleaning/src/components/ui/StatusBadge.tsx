import React from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface StatusBadgeProps {
  status: "success" | "warning" | "danger" | "neutral" | "info";
  children: React.ReactNode;
  className?: string;
}

export function StatusBadge({ status, children, className }: StatusBadgeProps) {
  const variants = {
    success: "bg-emerald-100 text-emerald-800 border-emerald-200",
    warning: "bg-amber-100 text-amber-800 border-amber-200",
    danger: "bg-rose-100 text-rose-800 border-rose-200",
    neutral: "bg-slate-100 text-slate-700 border-slate-200",
    info: "bg-blue-100 text-blue-800 border-blue-200",
  };

  return (
    <span className={cn(
      "px-2.5 py-1 rounded-full text-xs font-semibold border flex items-center w-fit",
      variants[status],
      className
    )}>
      {children}
    </span>
  );
}
