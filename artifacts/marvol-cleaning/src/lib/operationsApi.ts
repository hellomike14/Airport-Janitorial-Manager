import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export async function operationsApi<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api/operations${path}`, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Unable to save. Try again.");
  return data as T;
}
export function useOperations<T>(path: string, enabled = true) {
  const { currentUser } = useAuth();
  return useQuery<T>({
    queryKey: ["operations", currentUser?.id, path],
    queryFn: () => operationsApi<T>(path),
    enabled: !!currentUser && enabled,
    refetchOnWindowFocus: true,
  });
}
export function currentOrlandoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function currentGps(): Promise<{
  latitude: number;
  longitude: number;
  accuracy: number;
}> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation)
      return reject(new Error("This device does not support GPS."));
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      () =>
        reject(
          new Error(
            "Allow location access, move outdoors if needed, and try again.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}
export type TimeEntry = {
  id: number;
  staffId: number;
  staffName: string;
  workDate: string;
  clockIn: string;
  clockOut: string | null;
  breakMinutes: number;
  paidMinutes: number;
  approvedAt: string | null;
  correctionReason: string | null;
};
export type Badge = {
  staffId: number;
  staffName: string;
  badgeNumber: string;
  expiresOn: string;
  returnedOn: string | null;
  daysUntilExpiry: number;
  returnRequired: boolean;
};
export type Incident = {
  id: number;
  areaName: string;
  staffName: string;
  severity: string;
  category: string;
  description: string;
  immediateAction: string;
  occurredAt: string;
  status: string;
  resolution: string | null;
};
export type Supply = {
  id: number;
  name: string;
  unit: string;
  stock: number;
  reorderLevel: number;
};
export type SupplyRequest = {
  id: number;
  staffName: string;
  itemName: string;
  unit: string;
  quantity: number;
  notes: string | null;
  status: string;
};
export type AreaOption = { id: number; name: string; terminal: string };
export type StaffOption = {
  id: number;
  name: string;
  active: boolean;
  formerEmployee?: boolean;
};
export type ChecklistItem = {
  taskName: string;
  photoRequired: boolean;
  notes?: string;
};
export type Inspection = {
  id: number;
  areaName: string;
  staffName: string;
  inspectionDate: string;
  score: number;
  notes: string | null;
};
export type Audit = {
  uncoveredAreas: AreaOption[];
  ineligibleSchedules: { id: number; staffName: string }[];
  duplicateShifts: {
    staffName: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    ids: number[];
  }[];
  duplicateTasks: { areaId: number; taskName: string; copies: number }[];
  archivedAreas: AreaOption[];
  missingStaffEmails: { id: number; name: string }[];
};
export type MonthlyReport = {
  month: string;
  totalTasks: number;
  completedTasks: number;
  completionPercent: number;
  photoEvidence: number;
  generatedAt: string;
  areaPerformance: {
    areaId: number;
    areaName: string;
    terminal: string;
    total: number;
    completed: number;
    photoEvidence: number;
  }[];
  issues: { total: number; resolved: number };
  incidents: { total: number; open: number; highSeverity: number };
  inspections: {
    total: number;
    averageScore: number | null;
    passed: number;
    target: number;
  };
  timekeeping: {
    approvedHours: number;
    unapprovedEntries: number;
    openEntries: number;
  };
};
