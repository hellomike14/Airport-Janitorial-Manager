import React, { useState, useRef } from "react";
import { Camera, X, Loader2, ZoomIn, ArrowRight, ChevronDown, ChevronUp, ImageIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { storePhotoBlob } from "@/lib/offlineStore";
import { useOffline } from "@/contexts/OfflineContext";
import { useTranslation } from "react-i18next";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function requestPresignedUrl(file: File): Promise<{ uploadURL: string; objectPath: string }> {
  const res = await fetch(`${BASE_URL}/api/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      contentType: file.type,
      purpose: "staff-photo",
    }),
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
  if (!putRes.ok) throw new Error("Upload to storage failed");
  return objectPath;
}

function imageUrl(objectPath: string) {
  return `${BASE_URL}/api/storage${objectPath}`;
}

function PhotoSlot({
  label,
  objectPath,
  onUpload,
  onRemove,
  onFileCapture,
  accent = "blue",
  compact = false,
}: {
  label: string;
  objectPath: string | null;
  onUpload: (path: string) => void;
  onRemove: () => void;
  onFileCapture?: (file: File) => void;
  accent?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setPreview(URL.createObjectURL(file));

    if (onFileCapture) {
      onFileCapture(file);
    }

    if (!navigator.onLine) {
      return;
    }

    setUploading(true);
    try {
      const path = await uploadFile(file);
      onUpload(path);
    } catch (e) {
      console.error(e);
      if (!onFileCapture) {
        setPreview(null);
      }
    } finally {
      setUploading(false);
    }
  };

  const displaySrc = objectPath ? imageUrl(objectPath) : preview;
  const isDone = !!objectPath;

  return (
    <div className="flex-1 min-w-0">
      {label && <p className="text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">{label}</p>}

      {displaySrc ? (
        <div
          className={`relative rounded-xl overflow-hidden border border-slate-200 shadow-sm bg-slate-50 group cursor-pointer ${
            compact ? "aspect-[4/3]" : "aspect-video"
          }`}
          onClick={() => setLightbox(true)}
        >
          <img src={displaySrc} alt={label} className="w-full h-full object-cover" />
          {uploading && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-white animate-spin" />
            </div>
          )}
          {isDone && (
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
              <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}
          {!uploading && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setPreview(null); onRemove(); }}
              className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/50 hover:bg-red-500 text-white flex items-center justify-center transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`w-full rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1.5 transition-all
            hover:border-${accent}-400 hover:bg-${accent}-50/50 border-slate-200 bg-slate-50 text-slate-400 hover:text-${accent}-500
            ${compact ? "aspect-[4/3] py-3" : "aspect-video py-4"}`}
        >
          <Camera className={compact ? "w-5 h-5" : "w-6 h-6"} />
          <span className="text-xs font-medium">{t("taskPhotos.tapToAdd")}</span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />

      {lightbox && displaySrc && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(false)}
        >
          <button className="absolute top-4 right-4 text-white/70 hover:text-white">
            <X className="w-7 h-7" />
          </button>
          <img
            src={displaySrc}
            alt={label}
            className="max-w-full max-h-full rounded-xl shadow-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

export function TaskPhotoPanel({
  taskId,
  beforeImagePath,
  afterImagePath,
  compact = false,
}: {
  taskId: number;
  beforeImagePath: string | null;
  afterImagePath: string | null;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const { queueMutationIfOffline } = useOffline();
  const [before, setBefore] = useState<string | null>(beforeImagePath);
  const [after, setAfter] = useState<string | null>(afterImagePath);

  const updatePhoto = async (field: "beforeImagePath" | "afterImagePath", value: string | null) => {
    if (!navigator.onLine) {
      return;
    }
    const res = await fetch(`${BASE_URL}/api/tasks/${taskId}/images`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (!res.ok) {
      if (field === "beforeImagePath") setBefore(beforeImagePath);
      else setAfter(afterImagePath);
      return;
    }
    qc.invalidateQueries({ queryKey: ["/api/tasks"] });
  };

  const handleFileCapture = async (field: "beforeImagePath" | "afterImagePath", file: File) => {
    if (!navigator.onLine) {
      const blobKey = `${field}:task-${taskId}-${Date.now()}`;
      await storePhotoBlob(blobKey, file, file.name, file.type);
      await queueMutationIfOffline(
        "PATCH",
        `/api/tasks/${taskId}/images`,
        { [field]: null },
        [blobKey]
      );
    }
  };

  return (
    <div className="flex gap-3 items-start">
      <PhotoSlot
        label="Before"
        objectPath={before}
        onUpload={(path) => { setBefore(path); updatePhoto("beforeImagePath", path); }}
        onRemove={() => { setBefore(null); updatePhoto("beforeImagePath", null); }}
        onFileCapture={(file) => handleFileCapture("beforeImagePath", file)}
        accent="blue"
        compact={compact}
      />

      <div className="flex items-center self-center shrink-0 text-slate-300 mt-4">
        <ArrowRight className="w-4 h-4" />
      </div>

      <PhotoSlot
        label="After"
        objectPath={after}
        onUpload={(path) => { setAfter(path); updatePhoto("afterImagePath", path); }}
        onRemove={() => { setAfter(null); updatePhoto("afterImagePath", null); }}
        onFileCapture={(file) => handleFileCapture("afterImagePath", file)}
        accent="emerald"
        compact={compact}
      />
    </div>
  );
}

export function TaskPhotoToggle({
  taskId,
  beforeImagePath,
  afterImagePath,
  compact = false,
}: {
  taskId: number;
  beforeImagePath: string | null;
  afterImagePath: string | null;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasPhotos = !!beforeImagePath || !!afterImagePath;

  return (
    <div>
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg transition-colors ${
          hasPhotos
            ? "text-blue-600 bg-blue-50 hover:bg-blue-100 font-semibold"
            : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
        }`}
      >
        <Camera className="w-3.5 h-3.5" />
        {hasPhotos ? "Photos" : "Add Photos"}
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="mt-3 p-4 bg-slate-50 rounded-xl border border-slate-100" onClick={(e) => e.stopPropagation()}>
          <TaskPhotoPanel
            taskId={taskId}
            beforeImagePath={beforeImagePath}
            afterImagePath={afterImagePath}
            compact={compact}
          />
        </div>
      )}
    </div>
  );
}

export function TaskPhotoThumbnails({
  beforeImagePath,
  afterImagePath,
}: {
  beforeImagePath: string | null;
  afterImagePath: string | null;
}) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  if (!beforeImagePath && !afterImagePath) return null;

  return (
    <>
      <div className="flex gap-2 mt-1">
        {beforeImagePath && (
          <button
            onClick={(e) => { e.stopPropagation(); setLightbox(imageUrl(beforeImagePath)); }}
            className="w-10 h-10 rounded-lg overflow-hidden border border-blue-200 shadow-sm hover:ring-2 hover:ring-blue-300 transition-all"
          >
            <img src={imageUrl(beforeImagePath)} alt="Before" className="w-full h-full object-cover" />
          </button>
        )}
        {afterImagePath && (
          <button
            onClick={(e) => { e.stopPropagation(); setLightbox(imageUrl(afterImagePath)); }}
            className="w-10 h-10 rounded-lg overflow-hidden border border-emerald-200 shadow-sm hover:ring-2 hover:ring-emerald-300 transition-all"
          >
            <img src={imageUrl(afterImagePath)} alt="After" className="w-full h-full object-cover" />
          </button>
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
    </>
  );
}
