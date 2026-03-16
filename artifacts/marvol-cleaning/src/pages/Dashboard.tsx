import React, { useState } from "react";
import { format } from "date-fns";
import { useGetDashboard } from "@workspace/api-client-react";
import { 
  CheckCircle2, 
  Map as MapIcon, 
  AlertOctagon, 
  TrendingUp,
  ArrowRight,
  Clock
} from "lucide-react";
import { Link } from "wouter";

export default function Dashboard() {
  const [selectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  
  const { data: stats, isLoading, isError } = useGetDashboard({ date: selectedDate });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-64 bg-slate-200 animate-pulse rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-32 bg-white rounded-2xl animate-pulse shadow-sm" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="p-8 bg-rose-50 border border-rose-100 rounded-2xl text-center">
        <AlertOctagon className="w-12 h-12 text-rose-500 mx-auto mb-4" />
        <h2 className="text-lg font-bold text-rose-800">Failed to load dashboard</h2>
        <p className="text-rose-600 mt-2">Make sure the API server is running.</p>
      </div>
    );
  }

  const overallProgress = stats.totalTasks > 0 ? Math.round((stats.completedTasks / stats.totalTasks) * 100) : 0;

  return (
    <div className="space-y-8 pb-12">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Facility Overview</h1>
          <p className="text-slate-500 mt-1 flex items-center gap-2">
            <Clock className="w-4 h-4" /> Real-time status for {format(new Date(selectedDate), "MMMM do, yyyy")}
          </p>
        </div>
      </div>

      {/* Top Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard 
          title="Overall Completion" 
          value={`${overallProgress}%`} 
          subtitle={`${stats.completedTasks} of ${stats.totalTasks} tasks done`}
          icon={TrendingUp}
          colorClass="text-emerald-600 bg-emerald-100"
          progress={overallProgress}
        />
        <StatCard 
          title="Areas Cleared" 
          value={`${stats.completedAreas}/${stats.totalAreas}`} 
          subtitle="Fully completed zones"
          icon={MapIcon}
          colorClass="text-blue-600 bg-blue-100"
        />
        <StatCard 
          title="Open Issues" 
          value={stats.openIssues.toString()} 
          subtitle="Requires attention"
          icon={AlertOctagon}
          colorClass={stats.openIssues > 0 ? "text-rose-600 bg-rose-100" : "text-slate-600 bg-slate-100"}
          alert={stats.openIssues > 0}
        />
      </div>

      {/* Area Progress Grid */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-display font-bold text-slate-800">Coverage Areas Status</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {stats.areaProgress.map((area, idx) => (
            <AreaProgressCard key={area.areaId} area={area} delay={idx * 0.05} />
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, subtitle, icon: Icon, colorClass, progress, alert }: any) {
  return (
    <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-100 relative overflow-hidden group hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.08)] hover:-translate-y-1 transition-all duration-300">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">{title}</p>
          <h3 className="text-4xl font-display font-bold text-slate-900 mt-2">{value}</h3>
          <p className="text-sm text-slate-500 mt-1 font-medium">{subtitle}</p>
        </div>
        <div className={`p-4 rounded-2xl ${colorClass} ${alert ? 'animate-pulse' : ''}`}>
          <Icon className="w-8 h-8" />
        </div>
      </div>
      
      {progress !== undefined && (
        <div className="mt-6 w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div 
            className="h-full bg-emerald-500 rounded-full transition-all duration-1000 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

function AreaProgressCard({ area, delay }: any) {
  const isComplete = area.percentage === 100;
  const isDanger = area.percentage < 30;
  
  let progressColor = "bg-blue-500";
  let bgLight = "bg-blue-50";
  let textDark = "text-blue-700";
  
  if (isComplete) {
    progressColor = "bg-emerald-500";
    bgLight = "bg-emerald-50";
    textDark = "text-emerald-700";
  } else if (isDanger) {
    progressColor = "bg-rose-500";
    bgLight = "bg-rose-50";
    textDark = "text-rose-700";
  } else if (area.percentage > 75) {
    progressColor = "bg-amber-500";
    bgLight = "bg-amber-50";
    textDark = "text-amber-700";
  }

  return (
    <Link 
      href={`/areas/${area.areaId}`}
      className="block animate-stagger group"
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 hover:border-accent hover:shadow-md transition-all duration-200 h-full flex flex-col">
        <div className="flex justify-between items-start mb-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">{area.terminal}</span>
            <h3 className="font-display font-bold text-slate-800 text-lg group-hover:text-accent transition-colors">{area.areaName}</h3>
          </div>
          <div className={`p-2 rounded-xl ${bgLight} ${textDark}`}>
            {isComplete ? <CheckCircle2 className="w-5 h-5" /> : <MapIcon className="w-5 h-5" />}
          </div>
        </div>

        <div className="mt-auto">
          <div className="flex justify-between items-end mb-2">
            <div className="text-sm text-slate-500 font-medium">
              <span className="text-slate-900 font-bold">{area.completedTasks}</span> / {area.totalTasks} Tasks
            </div>
            <div className={`text-lg font-display font-bold ${textDark}`}>
              {area.percentage}%
            </div>
          </div>
          
          <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all duration-1000 ease-out ${progressColor}`}
              style={{ width: `${area.percentage}%` }}
            />
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
            <div className="flex -space-x-2">
              {area.assignedStaff && area.assignedStaff.length > 0 ? (
                area.assignedStaff.slice(0,3).map((staff: string, i: number) => (
                  <div key={i} className="w-8 h-8 rounded-full bg-slate-200 border-2 border-white flex items-center justify-center text-xs font-bold text-slate-600 z-10 relative hover:z-20 transition-transform hover:scale-110" title={staff}>
                    {staff.charAt(0)}
                  </div>
                ))
              ) : (
                <span className="text-xs text-slate-400 font-medium italic">Unassigned</span>
              )}
            </div>
            <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-accent group-hover:text-white transition-colors">
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
