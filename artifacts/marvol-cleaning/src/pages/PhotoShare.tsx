import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import {
  Camera,
  X,
  Send,
  Loader2,
  MapPin,
  User,
  Clock,
  Trash2,
  Image,
  ZoomIn,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { getDateLocale } from "@/i18n/dateLocale";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type SharedPhoto = {
  id: number;
  staffId: number;
  imagePath: string;
  caption: string | null;
  areaId: number | null;
  createdAt: string;
  staffName: string | null;
  staffRole: string | null;
  areaName: string | null;
  areaTerminal: string | null;
};

type Area = {
  id: number;
  name: string;
  terminal: string;
};

function imageUrl(objectPath: string) {
  return `${BASE_URL}/api/storage${objectPath}`;
}

async function requestPresignedUrl(file: File): Promise<{ uploadURL: string; objectPath: string }> {
  const res = await fetch(`${BASE_URL}/api/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!res.ok) throw new Error("Failed to get upload URL");
  return res.json();
}

async function uploadFile(file: File): Promise<string> {
  const { uploadURL, objectPath } = await requestPresignedUrl(file);
  const putRes = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putRes.ok) throw new Error("Upload failed");
  return objectPath;
}

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-violet-100 text-violet-700",
  supervisor: "bg-emerald-100 text-emerald-700",
  inspector: "bg-blue-100 text-blue-700",
  staff: "bg-amber-100 text-amber-700",
};

export default function PhotoShare() {
  const { t, i18n } = useTranslation();
  const { currentUser, effectiveRole } = useAuth();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dateLocale = getDateLocale(i18n.language);

  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [areaId, setAreaId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const { data: photos = [], isLoading } = useQuery<SharedPhoto[]>({
    queryKey: ["/api/shared-photos"],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/shared-photos`);
      return res.json();
    },
    refetchInterval: 15000,
  });

  const { data: areas = [] } = useQuery<Area[]>({
    queryKey: ["/api/areas"],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/areas`);
      return res.json();
    },
  });

  const deletePhoto = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE_URL}/api/shared-photos/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/shared-photos"] }),
  });

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setSelectedFile(file);
    setPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async () => {
    if (!selectedFile || !currentUser) return;
    setUploading(true);
    try {
      const objectPath = await uploadFile(selectedFile);
      const res = await fetch(`${BASE_URL}/api/shared-photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: currentUser.id,
          imagePath: objectPath,
          caption: caption.trim() || undefined,
          areaId,
        }),
      });
      if (!res.ok) throw new Error("Failed to share photo");
      setPreview(null);
      setSelectedFile(null);
      setCaption("");
      setAreaId(null);
      qc.invalidateQueries({ queryKey: ["/api/shared-photos"] });
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const clearPreview = () => {
    setPreview(null);
    setSelectedFile(null);
    setCaption("");
    setAreaId(null);
  };

  const isManager = effectiveRole === "admin" || effectiveRole === "supervisor";

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
            <Camera className="w-5 h-5 text-white" />
          </div>
          {t("photoShare.title")}
        </h1>
        <p className="text-slate-500 text-sm mt-1">{t("photoShare.subtitle")}</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        {preview ? (
          <div className="relative rounded-xl overflow-hidden border border-slate-200 aspect-video bg-slate-50">
            <img src={preview} alt="Preview" className="w-full h-full object-cover" />
            {uploading && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-white animate-spin" />
              </div>
            )}
            {!uploading && (
              <button
                onClick={clearPreview}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 hover:bg-red-500 text-white flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded-xl border-2 border-dashed border-slate-200 hover:border-blue-400 bg-slate-50 hover:bg-blue-50/50 text-slate-400 hover:text-blue-500 transition-all aspect-video flex flex-col items-center justify-center gap-2"
          >
            <Camera className="w-10 h-10" />
            <span className="text-sm font-medium">{t("photoShare.tapToCapture")}</span>
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileSelect(f);
            e.target.value = "";
          }}
        />

        {preview && (
          <>
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={t("photoShare.captionPlaceholder")}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
            />

            <select
              value={areaId ?? ""}
              onChange={(e) => setAreaId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none bg-white"
            >
              <option value="">{t("photoShare.noArea")}</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>{a.terminal} - {a.name}</option>
              ))}
            </select>

            <button
              onClick={handleSubmit}
              disabled={uploading}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t("photoShare.sharing")}
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  {t("photoShare.sharePhoto")}
                </>
              )}
            </button>
          </>
        )}
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-700 flex items-center gap-2">
          <Image className="w-5 h-5 text-blue-500" />
          {t("photoShare.recentPhotos")}
        </h2>

        {isLoading ? (
          <div className="text-center py-12 text-slate-400">{t("common.loading")}</div>
        ) : photos.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-slate-200">
            <Camera className="w-12 h-12 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">{t("photoShare.noPhotos")}</p>
          </div>
        ) : (
          photos.map((photo) => (
            <div key={photo.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden group">
              <div className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
                  {photo.staffName?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-800 text-sm truncate">{photo.staffName}</p>
                    {photo.staffRole && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize ${ROLE_COLORS[photo.staffRole] ?? "bg-slate-100 text-slate-600"}`}>
                        {photo.staffRole}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDistanceToNow(new Date(photo.createdAt), { addSuffix: true, locale: dateLocale })}
                    </span>
                    {photo.areaName && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {photo.areaTerminal} - {photo.areaName}
                      </span>
                    )}
                  </div>
                </div>
                {(isManager || photo.staffId === currentUser?.id) && (
                  <button
                    onClick={() => deletePhoto.mutate(photo.id)}
                    className="p-2 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {photo.caption && (
                <p className="px-4 pb-2 text-sm text-slate-600">{photo.caption}</p>
              )}

              <div
                className="relative cursor-pointer"
                onClick={() => setLightbox(imageUrl(photo.imagePath))}
              >
                <img
                  src={imageUrl(photo.imagePath)}
                  alt={photo.caption ?? "Shared photo"}
                  className="w-full aspect-video object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-all flex items-center justify-center">
                  <ZoomIn className="w-6 h-6 text-white opacity-0 hover:opacity-100 drop-shadow-lg transition-opacity" />
                </div>
              </div>
            </div>
          ))
        )}
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
