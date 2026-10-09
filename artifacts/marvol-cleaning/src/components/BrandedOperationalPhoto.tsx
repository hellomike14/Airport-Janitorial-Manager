import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

const base = import.meta.env.BASE_URL || "/";

export function watermarkMetrics(width: number, height: number) {
  const shortEdge = Math.max(1, Math.min(width, height));
  const logoSize = Math.max(1, Math.min(92, Math.round(shortEdge * 0.12)));
  const padding = Math.max(2, Math.round(logoSize * 0.16));
  const margin = Math.max(2, Math.round(shortEdge * 0.025));
  const badgeSize = logoSize + padding * 2;
  return {
    logoSize,
    padding,
    margin,
    badgeSize,
    x: Math.max(0, width - margin - badgeSize),
    y: Math.max(0, height - margin - badgeSize),
  };
}

export function BrandedOperationalPhoto({
  src,
  alt,
  className = "",
  wrapperClassName = "relative inline-block overflow-hidden align-bottom",
  compact = false,
}: {
  src: string;
  alt: string;
  className?: string;
  wrapperClassName?: string;
  compact?: boolean;
}) {
  return (
    <span className={wrapperClassName}>
      <img src={src} alt={alt} className={className} />
      <span
        role="img"
        aria-label="Marvol Facility Services logo"
        className={`pointer-events-none absolute bottom-2 right-2 flex items-center justify-center rounded-md border border-white/80 bg-white/90 shadow-lg ${
          compact ? "h-7 w-7 p-1" : "h-10 w-10 p-1.5"
        }`}
      >
        <img src={`${base}logo-mark.png`} alt="" className="h-full w-full object-contain" />
      </span>
    </span>
  );
}

function imageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to read the operational photo."));
    };
    image.src = url;
  });
}

export async function createBrandedOperationalPhoto(
  source: string,
): Promise<Blob> {
  const [photoResponse, logoResponse] = await Promise.all([
    fetch(source, { credentials: "same-origin", cache: "no-store" }),
    fetch(`${base}logo-mark.png`, { credentials: "same-origin", cache: "force-cache" }),
  ]);
  if (!photoResponse.ok) throw new Error("Unable to download this operational photo.");
  if (!logoResponse.ok) throw new Error("The approved Marvol logo is unavailable.");
  const [photo, logo] = await Promise.all([
    imageFromBlob(await photoResponse.blob()),
    imageFromBlob(await logoResponse.blob()),
  ]);
  const width = photo.naturalWidth;
  const height = photo.naturalHeight;
  if (!width || !height) throw new Error("The operational photo has invalid dimensions.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot create a branded photo export.");
  context.drawImage(photo, 0, 0, width, height);
  const metrics = watermarkMetrics(width, height);
  context.fillStyle = "rgba(255,255,255,0.94)";
  context.fillRect(metrics.x, metrics.y, metrics.badgeSize, metrics.badgeSize);
  context.strokeStyle = "rgba(6,78,59,0.55)";
  context.lineWidth = Math.max(1, Math.round(metrics.padding / 4));
  context.strokeRect(metrics.x, metrics.y, metrics.badgeSize, metrics.badgeSize);
  context.drawImage(
    logo,
    metrics.x + metrics.padding,
    metrics.y + metrics.padding,
    metrics.logoSize,
    metrics.logoSize,
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob
        ? resolve(blob)
        : reject(new Error("Unable to create the branded photo export.")),
      "image/jpeg",
      0.94,
    );
  });
}

export function BrandedOperationalPhotoDownload({
  src,
  filename = "marvol-operational-photo.jpg",
}: {
  src: string;
  filename?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const download = async () => {
    setBusy(true);
    setError("");
    try {
      const blob = await createBrandedOperationalPhoto(src);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename
        .replace(/[\\/]/g, "_")
        .replace(/\.(?:png|webp|heic|jpeg?)$/i, "") + ".jpg";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to export the photo.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-md bg-white/15 px-3 py-2 text-sm font-semibold text-white hover:bg-white/25 disabled:opacity-50 print:hidden"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
        {busy ? "Preparing…" : "Download branded copy"}
      </button>
      {error && <span role="alert" className="text-xs text-rose-200">{error}</span>}
    </span>
  );
}
