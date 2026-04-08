import React, { useState, useRef } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { useTranslation } from "react-i18next";
import { getDateLocale } from "@/i18n/dateLocale";
import { useGetDashboard } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  CheckCircle2, 
  Map as MapIcon, 
  AlertOctagon, 
  TrendingUp,
  ArrowRight,
  Clock,
  Camera,
  MapPin,
  ZoomIn,
  X,
} from "lucide-react";
import { Link } from "wouter";
import RefreshButton from "@/components/RefreshButton";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type SharedPhoto = {
  id: number;
  staffId: number;
  imagePath: string;
  caption: string | null;
  areaId: number | null;
  latitude: number | null;
  longitude: number | null;
  takenAt: string | null;
  createdAt: string;
  staffName: string | null;
  staffRole: string | null;
  areaName: string | null;
  areaTerminal: string | null;
};

function imageUrl(objectPath: string) {
  return `${BASE_URL}/api/storage${objectPath}`;
}

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-violet-100 text-violet-700",
  supervisor: "bg-emerald-100 text-emerald-700",
  inspector: "bg-blue-100 text-blue-700",
  staff: "bg-amber-100 text-amber-700",
};

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateLocale(i18n.language);
  const [selectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [lightbox, setLightbox] = useState<string | null>(null);
  
  const qc = useQueryClient();
  const lastUpdatedRef = useRef<Date>(new Date());

  const { data: stats, isLoading, isError } = useGetDashboard({ date: selectedDate });

  const { data: photos = [] } = useQuery<SharedPhoto[]>({
    queryKey: ["/api/shared-photos"],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/shared-photos`);
      return res.json();
    },
    refetchInterval: 15000,
  });

  const recentPhotos = photos.slice(0, 6);

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
        <h2 className="text-lg font-bold text-rose-800">{t("dashboard.failedToLoadDashboard")}</h2>
        <p className="text-rose-600 mt-2">{t("dashboard.apiServerError")}</p>
      </div>
    );
  }

  const overallProgress = stats.totalTasks > 0 ? Math.round((stats.completedTasks / stats.totalTasks) * 100) : 0;

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">{t("dashboard.facilityOverview")}</h1>
          <p className="text-slate-500 mt-1 flex items-center gap-2">
            <Clock className="w-4 h-4" /> {t("dashboard.realTimeStatus", { date: format(new Date(selectedDate), "MMMM do, yyyy", { locale: dateLocale }) })}
          </p>
        </div>
        <RefreshButton
          lastUpdated={lastUpdatedRef.current}
          onRefresh={async () => {
            await qc.invalidateQueries();
            lastUpdatedRef.current = new Date();
          }}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard 
          title={t("dashboard.overallCompletion")}
          value={`${overallProgress}%`} 
          subtitle={t("dashboard.tasksOfTotal", { completed: stats.completedTasks, total: stats.totalTasks })}
          icon={TrendingUp}
          colorClass="text-emerald-600 bg-emerald-100"
          progress={overallProgress}
        />
        <StatCard 
          title={t("dashboard.areasCleared")}
          value={`${stats.completedAreas}/${stats.totalAreas}`} 
          subtitle={t("dashboard.fullyCompletedZones")}
          icon={MapIcon}
          colorClass="text-blue-600 bg-blue-100"
        />
        <StatCard 
          title={t("dashboard.openIssues")}
          value={stats.openIssues.toString()} 
          subtitle={t("dashboard.requiresAttention")}
          icon={AlertOctagon}
          colorClass={stats.openIssues > 0 ? "text-rose-600 bg-rose-100" : "text-slate-600 bg-slate-100"}
          alert={stats.openIssues > 0}
        />
        <StatCard
          title={t("dashboard.photosShared")}
          value={photos.length.toString()}
          subtitle={t("dashboard.teamPhotoFeed")}
          icon={Camera}
          colorClass="text-indigo-600 bg-indigo-100"
          href="/photo-share"
        />
      </div>

      {recentPhotos.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-display font-bold text-slate-800 flex items-center gap-2">
              <Camera className="w-5 h-5 text-indigo-500" />
              {t("dashboard.recentPhotos")}
            </h2>
            <Link href="/photo-share" className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 transition-colors">
              {t("dashboard.viewAll")}
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {recentPhotos.map((photo) => (
              <div
                key={photo.id}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden group cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                onClick={() => setLightbox(imageUrl(photo.imagePath))}
              >
                <div className="relative aspect-square">
                  <img
                    src={imageUrl(photo.imagePath)}
                    alt={photo.caption ?? "Shared photo"}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                    <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 drop-shadow-lg transition-opacity" />
                  </div>
                  {photo.takenAt && (
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 pt-4 pb-1.5">
                      <p className="text-[10px] font-mono text-white/90 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {format(new Date(photo.takenAt), "HH:mm")}
                      </p>
                    </div>
                  )}
                </div>
                <div className="p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white text-[8px] font-bold shrink-0">
                      {photo.staffName?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "?"}
                    </div>
                    <p className="text-xs font-semibold text-slate-700 truncate">{photo.staffName?.split(" ")[0]}</p>
                    {photo.staffRole && (
                      <span className={`text-[8px] font-semibold px-1 py-0.5 rounded-full capitalize ${ROLE_COLORS[photo.staffRole] ?? "bg-slate-100 text-slate-600"}`}>
                        {photo.staffRole}
                      </span>
                    )}
                  </div>
                  {photo.caption && (
                    <p className="text-[11px] text-slate-500 truncate">{photo.caption}</p>
                  )}
                  {photo.areaName && (
                    <p className="text-[10px] text-slate-400 flex items-center gap-0.5 mt-0.5 truncate">
                      <MapPin className="w-2.5 h-2.5 shrink-0" />
                      {photo.areaTerminal} - {photo.areaName}
                    </p>
                  )}
                  <p className="text-[10px] text-slate-300 mt-0.5">
                    {formatDistanceToNow(new Date(photo.createdAt), { addSuffix: true, locale: dateLocale })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-display font-bold text-slate-800">{t("dashboard.coverageAreasStatus")}</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {stats.areaProgress.map((area, idx) => (
            <AreaProgressCard key={area.areaId} area={area} delay={idx * 0.05} />
          ))}
        </div>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button className="absolute top-4 right-4 text-white/70 hover:text-white">
            <X className="w-7 h-7" />
          </button>
          <img
            src={lightbox}
            alt="Photo"
            className="max-w-full max-h-full rounded-xl shadow-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, subtitle, icon: Icon, colorClass, progress, alert, href }: any) {
  const content = (
    <div className={`bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-100 relative overflow-hidden group hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.08)] hover:-translate-y-1 transition-all duration-300 ${href ? 'cursor-pointer' : ''}`}>
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

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}

function AreaProgressCard({ area, delay }: any) {
  const { t } = useTranslation();
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
              <span className="text-slate-900 font-bold">{area.completedTasks}</span> / {area.totalTasks} {t("dashboard.tasks")}
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
                <span className="text-xs text-slate-400 font-medium italic">{t("dashboard.unassigned")}</span>
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
