import React, { useState, useEffect, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { MapPin, RefreshCw, Clock, Navigation, Users, Shield, UserCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import "leaflet/dist/leaflet.css";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

const MCO_CENTER: [number, number] = [28.4312, -81.3081];

interface StaffLocationData {
  id: number;
  staffId: number;
  staffName: string;
  staffRole: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  updatedAt: string;
}

function createMarkerIcon(role: string, isSelected: boolean) {
  const color =
    role === "supervisor"
      ? "#2563eb"
      : role === "admin"
      ? "#7c3aed"
      : "#059669";
  const size = isSelected ? 40 : 32;
  const borderWidth = isSelected ? 4 : 3;

  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      width: ${size}px; height: ${size}px;
      background: ${color}; border: ${borderWidth}px solid white;
      border-radius: 50%; box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
      color: white; font-weight: bold; font-size: ${isSelected ? 14 : 12}px;
      font-family: system-ui;
      ${isSelected ? "animation: pulse 1.5s infinite;" : ""}
    ">${role === "supervisor" ? "S" : role === "admin" ? "A" : "✦"}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2)],
  });
}

function FlyToLocation({ location }: { location: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (location) {
      map.flyTo(location, 17, { duration: 1 });
    }
  }, [location, map]);
  return null;
}

export default function GPSTracking() {
  const { viewMode } = useAuth();
  const [locations, setLocations] = useState<StaffLocationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStaff, setSelectedStaff] = useState<number | null>(null);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const fetchLocations = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/locations`);
      if (res.ok) {
        const data = await res.json();
        setLocations(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => {
    fetchLocations();
    const interval = setInterval(fetchLocations, 15000);
    return () => clearInterval(interval);
  }, [fetchLocations]);

  const handleSelectStaff = (staffId: number) => {
    setSelectedStaff(staffId === selectedStaff ? null : staffId);
    const loc = locations.find((l) => l.staffId === staffId);
    if (loc) {
      setFlyTarget([loc.latitude, loc.longitude]);
    }
  };

  const supervisors = locations.filter((l) => l.staffRole === "supervisor" || l.staffRole === "admin");
  const staff = locations.filter((l) => l.staffRole === "staff");

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900 flex items-center gap-3">
            <Navigation className="w-8 h-8 text-emerald-600" />
            GPS Staff Tracking
          </h1>
          <p className="text-slate-500 mt-1 font-medium">
            Real-time location of staff and supervisors at MCO
          </p>
        </div>
        <button
          onClick={fetchLocations}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors shadow-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        <div className="lg:col-span-3">
          <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm" style={{ height: 500 }}>
            <style>{`
              @keyframes pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.15); }
              }
              .leaflet-container { height: 100%; width: 100%; }
            `}</style>
            <MapContainer center={MCO_CENTER} zoom={15} scrollWheelZoom={true} style={{ height: "100%", width: "100%" }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <FlyToLocation location={flyTarget} />
              {locations.map((loc) => (
                <Marker
                  key={loc.staffId}
                  position={[loc.latitude, loc.longitude]}
                  icon={createMarkerIcon(loc.staffRole, selectedStaff === loc.staffId)}
                  eventHandlers={{
                    click: () => handleSelectStaff(loc.staffId),
                  }}
                >
                  <Popup>
                    <div className="text-sm min-w-[160px]">
                      <p className="font-bold text-slate-900">{loc.staffName}</p>
                      <p className="text-xs text-slate-500 capitalize">{loc.staffRole}</p>
                      <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDistanceToNow(new Date(loc.updatedAt), { addSuffix: true })}
                      </p>
                      {loc.accuracy && (
                        <p className="text-xs text-slate-400">
                          Accuracy: ±{Math.round(loc.accuracy)}m
                        </p>
                      )}
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-600" />
              <span className="font-bold text-blue-900 text-sm">Supervisors</span>
              <span className="ml-auto text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">
                {supervisors.length}
              </span>
            </div>
            <div className="divide-y divide-slate-50">
              {supervisors.length === 0 && (
                <p className="text-xs text-slate-400 px-4 py-3 italic">No supervisor locations yet</p>
              )}
              {supervisors.map((loc) => (
                <button
                  key={loc.staffId}
                  onClick={() => handleSelectStaff(loc.staffId)}
                  className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                    selectedStaff === loc.staffId ? "bg-blue-50" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                    {loc.staffName.split(" ").map((n) => n[0]).join("")}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{loc.staffName}</p>
                    <p className="text-xs text-slate-400">
                      {formatDistanceToNow(new Date(loc.updatedAt), { addSuffix: true })}
                    </p>
                  </div>
                  <MapPin className={`w-4 h-4 ml-auto shrink-0 ${selectedStaff === loc.staffId ? "text-blue-500" : "text-slate-300"}`} />
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-emerald-50 border-b border-emerald-100 flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-600" />
              <span className="font-bold text-emerald-900 text-sm">Staff</span>
              <span className="ml-auto text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">
                {staff.length}
              </span>
            </div>
            <div className="divide-y divide-slate-50 max-h-[280px] overflow-y-auto">
              {staff.length === 0 && (
                <p className="text-xs text-slate-400 px-4 py-3 italic">No staff locations yet</p>
              )}
              {staff.map((loc) => (
                <button
                  key={loc.staffId}
                  onClick={() => handleSelectStaff(loc.staffId)}
                  className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                    selectedStaff === loc.staffId ? "bg-emerald-50" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                    {loc.staffName.split(" ").map((n) => n[0]).join("")}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{loc.staffName}</p>
                    <p className="text-xs text-slate-400">
                      {formatDistanceToNow(new Date(loc.updatedAt), { addSuffix: true })}
                    </p>
                  </div>
                  <MapPin className={`w-4 h-4 ml-auto shrink-0 ${selectedStaff === loc.staffId ? "text-emerald-500" : "text-slate-300"}`} />
                </button>
              ))}
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl px-4 py-3 text-xs text-slate-500 flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" />
            Auto-refreshes every 15s · Last: {lastRefresh.toLocaleTimeString()}
          </div>
        </div>
      </div>
    </div>
  );
}
