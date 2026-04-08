import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { getDateLocale } from "@/i18n/dateLocale";
import { useAuth } from "@/contexts/AuthContext";
import {
  Calendar,
  Clock,
  MapPin,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  User,
  X,
  Save,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type ScheduleEntry = {
  id: number;
  staffId: number;
  areaId: number | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  notes: string | null;
  staffName: string | null;
  staffRole: string | null;
  areaName: string | null;
  areaTerminal: string | null;
};

type StaffMember = {
  id: number;
  name: string;
  role: string;
  active: boolean;
};

type Area = {
  id: number;
  name: string;
  terminal: string;
};

function useSchedules(staffId?: number) {
  return useQuery<ScheduleEntry[]>({
    queryKey: ["/api/schedules", staffId],
    queryFn: async () => {
      const params = staffId ? `?staffId=${staffId}` : "";
      const res = await fetch(`${BASE_URL}/api/schedules${params}`);
      return res.json();
    },
  });
}

function useStaffList() {
  return useQuery<StaffMember[]>({
    queryKey: ["/api/staff"],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/staff`);
      return res.json();
    },
  });
}

function useAreas() {
  return useQuery<Area[]>({
    queryKey: ["/api/areas"],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/areas`);
      return res.json();
    },
  });
}

const DAY_COLORS = [
  "bg-red-50 border-red-200",
  "bg-orange-50 border-orange-200",
  "bg-amber-50 border-amber-200",
  "bg-emerald-50 border-emerald-200",
  "bg-blue-50 border-blue-200",
  "bg-violet-50 border-violet-200",
  "bg-pink-50 border-pink-200",
];

const DAY_HEADER_COLORS = [
  "bg-red-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-blue-500",
  "bg-violet-500",
  "bg-pink-500",
];

const TIME_SLOTS = [
  "06:00", "07:00", "08:00", "09:00", "10:00", "11:00",
  "12:00", "13:00", "14:00", "15:00", "16:00", "17:00",
  "18:00", "19:00", "20:00", "21:00", "22:00",
];

function formatTime12(time24: string): string {
  const [h, m] = time24.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

function AddScheduleModal({
  staffList,
  areas,
  onClose,
  onSave,
  preselectedStaffId,
}: {
  staffList: StaffMember[];
  areas: Area[];
  onClose: () => void;
  onSave: (data: { staffId: number; areaId: number | null; dayOfWeek: number; startTime: string; endTime: string; notes: string }) => void;
  preselectedStaffId?: number;
}) {
  const { t } = useTranslation();
  const [staffId, setStaffId] = useState<number>(preselectedStaffId ?? 0);
  const [areaId, setAreaId] = useState<number | null>(null);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("16:00");
  const [notes, setNotes] = useState("");

  const DAY_NAMES = [
    t("portal.sunday"), t("portal.monday"), t("portal.tuesday"),
    t("portal.wednesday"), t("portal.thursday"), t("portal.friday"), t("portal.saturday"),
  ];

  const activeStaff = staffList.filter((s) => s.active && s.role === "staff");

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-slate-800 text-lg">{t("portal.addShift")}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          {!preselectedStaffId && (
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">{t("portal.employee")}</label>
              <select
                value={staffId}
                onChange={(e) => setStaffId(Number(e.target.value))}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
              >
                <option value={0}>{t("portal.selectEmployee")}</option>
                {activeStaff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-slate-700 mb-1 block">{t("portal.dayOfWeek")}</label>
            <select
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(Number(e.target.value))}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
            >
              {DAY_NAMES.map((name, i) => (
                <option key={i} value={i}>{name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">{t("portal.startTime")}</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">{t("portal.endTime")}</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-1 block">{t("portal.area")}</label>
            <select
              value={areaId ?? ""}
              onChange={(e) => setAreaId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
            >
              <option value="">{t("portal.noSpecificArea")}</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>{a.terminal} - {a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-1 block">{t("portal.notes")}</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("portal.notesPlaceholder")}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
            />
          </div>
        </div>

        <button
          onClick={() => {
            if (staffId === 0 && !preselectedStaffId) return;
            onSave({ staffId: preselectedStaffId ?? staffId, areaId, dayOfWeek, startTime, endTime, notes });
          }}
          disabled={staffId === 0 && !preselectedStaffId}
          className="w-full mt-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" />
          {t("portal.saveShift")}
        </button>
      </div>
    </div>
  );
}

export default function EmployeePortal() {
  const { t, i18n } = useTranslation();
  const { currentUser, effectiveRole } = useAuth();
  const qc = useQueryClient();
  const isManager = effectiveRole === "admin" || effectiveRole === "supervisor";
  const isStaff = effectiveRole === "staff";

  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(
    isStaff && currentUser ? currentUser.id : null
  );
  const [showAddModal, setShowAddModal] = useState(false);

  const { data: schedules = [], isLoading } = useSchedules(selectedStaffId ?? undefined);
  const { data: staffList = [] } = useStaffList();
  const { data: areas = [] } = useAreas();

  const dateLocale = getDateLocale(i18n.language);

  const DAY_NAMES = [
    t("portal.sunday"), t("portal.monday"), t("portal.tuesday"),
    t("portal.wednesday"), t("portal.thursday"), t("portal.friday"), t("portal.saturday"),
  ];

  const DAY_ABBREV = [
    t("portal.sunAbbr"), t("portal.monAbbr"), t("portal.tueAbbr"),
    t("portal.wedAbbr"), t("portal.thuAbbr"), t("portal.friAbbr"), t("portal.satAbbr"),
  ];

  const createSchedule = useMutation({
    mutationFn: async (data: { staffId: number; areaId: number | null; dayOfWeek: number; startTime: string; endTime: string; notes: string }) => {
      const res = await fetch(`${BASE_URL}/api/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to save shift" }));
        throw new Error(err.error || "Failed to save shift");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/schedules"] });
      setShowAddModal(false);
    },
  });

  const deleteSchedule = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE_URL}/api/schedules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete shift");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/schedules"] });
    },
  });

  const schedulesByDay = useMemo(() => {
    const map: Record<number, ScheduleEntry[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    schedules.forEach((s) => {
      if (map[s.dayOfWeek]) map[s.dayOfWeek].push(s);
    });
    return map;
  }, [schedules]);

  const totalHours = useMemo(() => {
    return schedules.reduce((sum, s) => {
      const [sh, sm] = s.startTime.split(":").map(Number);
      const [eh, em] = s.endTime.split(":").map(Number);
      return sum + (eh + em / 60) - (sh + sm / 60);
    }, 0);
  }, [schedules]);

  const selectedStaff = staffList.find((s) => s.id === selectedStaffId);
  const activeStaff = staffList.filter((s) => s.active && s.role === "staff");

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            {t("portal.title")}
          </h1>
          <p className="text-slate-500 text-sm mt-1">{t("portal.subtitle")}</p>
        </div>

        <div className="flex items-center gap-3">
          {isManager && (
            <select
              value={selectedStaffId ?? "all"}
              onChange={(e) => setSelectedStaffId(e.target.value === "all" ? null : Number(e.target.value))}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
            >
              <option value="all">{t("portal.allEmployees")}</option>
              {activeStaff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          {isManager && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t("portal.addShift")}
            </button>
          )}
        </div>
      </div>

      {selectedStaffId && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white font-bold">
            {selectedStaff?.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "?"}
          </div>
          <div className="flex-1">
            <p className="font-semibold text-slate-800">{selectedStaff?.name ?? t("portal.employee")}</p>
            <p className="text-sm text-slate-500 capitalize">{selectedStaff?.role}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-emerald-600">{totalHours.toFixed(1)}</p>
            <p className="text-xs text-slate-500">{t("portal.hoursPerWeek")}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-blue-600">{schedules.length}</p>
            <p className="text-xs text-slate-500">{t("portal.shifts")}</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-slate-400">{t("common.loading")}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-3">
          {[0, 1, 2, 3, 4, 5, 6].map((day) => {
            const daySchedules = schedulesByDay[day] ?? [];
            return (
              <div key={day} className={`rounded-2xl border ${DAY_COLORS[day]} overflow-hidden`}>
                <div className={`${DAY_HEADER_COLORS[day]} text-white px-3 py-2.5 text-center`}>
                  <p className="font-bold text-sm">{DAY_NAMES[day]}</p>
                  <p className="text-[10px] opacity-80">{DAY_ABBREV[day]}</p>
                </div>

                <div className="p-2 space-y-2 min-h-[120px]">
                  {daySchedules.length === 0 ? (
                    <div className="flex items-center justify-center h-[100px] text-slate-300 text-xs">
                      {t("portal.noShifts")}
                    </div>
                  ) : (
                    daySchedules.map((s) => (
                      <div key={s.id} className="bg-white rounded-xl p-2.5 shadow-sm border border-white/80 group relative">
                        <div className="flex items-center gap-1.5 text-emerald-700 mb-1">
                          <Clock className="w-3 h-3" />
                          <span className="text-xs font-semibold">
                            {formatTime12(s.startTime)} - {formatTime12(s.endTime)}
                          </span>
                        </div>
                        {!selectedStaffId && s.staffName && (
                          <div className="flex items-center gap-1.5 text-slate-600 mb-1">
                            <User className="w-3 h-3" />
                            <span className="text-xs truncate">{s.staffName}</span>
                          </div>
                        )}
                        {s.areaName && (
                          <div className="flex items-center gap-1.5 text-blue-600">
                            <MapPin className="w-3 h-3" />
                            <span className="text-[10px] truncate">{s.areaTerminal} - {s.areaName}</span>
                          </div>
                        )}
                        {s.notes && (
                          <p className="text-[10px] text-slate-400 mt-1 truncate">{s.notes}</p>
                        )}
                        {isManager && (
                          <button
                            onClick={() => deleteSchedule.mutate(s.id)}
                            className="absolute top-1 right-1 p-1 rounded-lg bg-red-50 text-red-400 hover:text-red-600 hover:bg-red-100 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddModal && (
        <AddScheduleModal
          staffList={staffList}
          areas={areas}
          preselectedStaffId={selectedStaffId ?? undefined}
          onClose={() => setShowAddModal(false)}
          onSave={(data) => createSchedule.mutate(data)}
        />
      )}
    </div>
  );
}
