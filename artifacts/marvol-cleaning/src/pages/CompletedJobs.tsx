import React, { useState, useMemo } from "react";
import { format, parseISO, subDays } from "date-fns";
import { useTranslation } from "react-i18next";
import { getDateLocale } from "@/i18n/dateLocale";
import {
  useListTasks,
  useListAreas,
} from "@workspace/api-client-react";
import {
  CheckCircle2,
  Clock,
  MapPin,
  Filter,
  Calendar,
  User,
  Star,
} from "lucide-react";
import { TaskPhotoThumbnails, TaskPhotoToggle } from "@/components/TaskPhotos";
import { StaffName } from "@/components/StaffName";

export default function CompletedJobs() {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateLocale(i18n.language);
  const today = format(new Date(), "yyyy-MM-dd");
  const [selectedDate, setSelectedDate] = useState(today);

  const { data: areas } = useListAreas();
  const { data: tasks, isLoading } = useListTasks({ date: selectedDate });

  const completedTasks = useMemo(
    () => (tasks ?? []).filter((t) => t.completed),
    [tasks]
  );

  const totalCompleted = completedTasks.length;

  const groupedByArea = useMemo(() => {
    const areaList = areas ?? [];
    const map = new Map<
      number,
      { area: (typeof areaList)[0]; tasks: typeof completedTasks }
    >();

    for (const task of completedTasks) {
      if (!map.has(task.areaId)) {
        const area = areaList.find((a) => a.id === task.areaId);
        if (area) map.set(task.areaId, { area, tasks: [] });
      }
      map.get(task.areaId)?.tasks.push(task);
    }

    return Array.from(map.values()).sort((a, b) =>
      a.area.name.localeCompare(b.area.name)
    );
  }, [completedTasks, areas]);

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900 flex items-center gap-3">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            {t("completedJobs.title")}
          </h1>
          <p className="text-slate-500 mt-1 font-medium">
            {t("completedJobs.subtitle")}
          </p>
        </div>

        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
          <Calendar className="w-4 h-4 text-emerald-500" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="text-sm font-semibold text-slate-700 bg-transparent outline-none cursor-pointer"
          />
          {selectedDate !== today && (
            <button
              onClick={() => setSelectedDate(today)}
              className="ml-1 text-xs text-accent font-semibold hover:underline"
            >
              {t("common.today")}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-emerald-50 rounded-2xl border border-emerald-200 px-5 py-4 shadow-sm">
          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">
            {t("completedJobs.completed")}
          </p>
          <p className="text-3xl font-bold text-emerald-700 mt-1">
            {totalCompleted}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 bg-slate-100 rounded-2xl animate-pulse"
            />
          ))}
        </div>
      ) : groupedByArea.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white rounded-3xl border border-slate-200 border-dashed">
          <Filter className="w-10 h-10 text-slate-300 mb-3" />
          <p className="text-slate-600 font-semibold text-lg">
            {t("completedJobs.noCompletedTasks")}
          </p>
          <p className="text-slate-400 text-sm mt-1">
            {t("completedJobs.noTasksCompletedFor", { date: format(parseISO(selectedDate), "MMMM d, yyyy", { locale: dateLocale }) })}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedByArea.map(({ area, tasks: areaTasks }) => {
            return (
              <div
                key={area.id}
                className="bg-white rounded-2xl border border-emerald-200 shadow-sm overflow-hidden"
              >
                <div className="flex items-center gap-4 px-5 py-4 bg-emerald-50/60">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-emerald-500">
                    <MapPin className="w-4 h-4 text-white" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h2 className="font-bold text-slate-800">{area.name}</h2>
                      <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {areaTasks.length} · {t("completedJobs.completed")}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-100 divide-y divide-slate-50">
                  {areaTasks.map((task) => (
                    <div
                      key={task.id}
                      className="px-5 py-3"
                    >
                      <div className="flex items-start gap-4">
                        <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-600 line-through">
                            {task.taskName}
                          </p>
                          {task.isSpecial && (
                            <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                              <Star className="w-2.5 h-2.5" /> {t("completedJobs.specialRequest")}
                            </span>
                          )}
                          {task.notes && (
                            <p className="text-xs text-slate-400 italic mt-0.5">
                              "{task.notes}"
                            </p>
                          )}
                          <TaskPhotoThumbnails
                            beforeImagePath={(task as any).beforeImagePath ?? null}
                            afterImagePath={(task as any).afterImagePath ?? null}
                          />
                        </div>
                        <div className="shrink-0 flex flex-col items-end gap-2">
                          <div className="text-right">
                            {task.completedAt && (
                              <p className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {format(new Date(task.completedAt), "h:mm a", { locale: dateLocale })}
                              </p>
                            )}
                            {task.completedByName && (
                              <p className="text-[10px] text-slate-400 flex items-center gap-1 justify-end mt-0.5">
                                <User className="w-2.5 h-2.5" />
                                <StaffName name={task.completedByName} active={task.completedByActive} />
                              </p>
                            )}
                          </div>
                          <TaskPhotoToggle
                            taskId={task.id}
                            beforeImagePath={(task as any).beforeImagePath ?? null}
                            afterImagePath={(task as any).afterImagePath ?? null}
                            compact
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
