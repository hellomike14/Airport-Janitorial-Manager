import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const UPDATE_INTERVAL = 30000;

export function useLocationTracker() {
  const { currentUser, viewMode } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchRef = useRef<number | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    if (viewMode !== "staff" && viewMode !== "supervisor" && viewMode !== "admin") return;
    if (!navigator.geolocation) return;

    const sendLocation = (position: GeolocationPosition) => {
      const { latitude, longitude, accuracy } = position.coords;
      fetch(`${BASE_URL}/api/locations/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: currentUser.id,
          latitude,
          longitude,
          accuracy,
        }),
      }).catch(() => {});
    };

    navigator.geolocation.getCurrentPosition(sendLocation, () => {}, {
      enableHighAccuracy: true,
      timeout: 10000,
    });

    intervalRef.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(sendLocation, () => {}, {
        enableHighAccuracy: true,
        timeout: 10000,
      });
    }, UPDATE_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, [currentUser, viewMode]);
}
