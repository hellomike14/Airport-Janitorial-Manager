import { customFetch } from "./custom-fetch";

const base = () => `${((import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/").replace(/\/$/, "")}/api/identity-documents`;
export const IDENTITY_MAX_BYTES = 8 * 1024 * 1024;
export type IdentityCategory = "identity" | "work_authorization" | "social_security";
export type IdentitySide = "front" | "back";
export type PhotoStatus = "uploaded" | "needs_clearer_photo" | "reviewed";
export type PhotoReason = "blurry" | "glare" | "cropped" | "wrong_side" | "other";
export interface IdentityHire { id: number; name: string; staffId: number | null; staffName: string | null }
export interface IdentityContext {
  canManage: boolean; hires: IdentityHire[]; employees: { id: number; name: string }[];
  maxBytes: number; acceptedTypes: string[];
}
export interface IdentityPhoto {
  id: string; hireId: number; category: IdentityCategory; side: IdentitySide; status: PhotoStatus;
  uploadedAt: string; uploadedBy: { id: number; name: string };
  reviewedAt: string | null; reviewedBy: { id: number; name: string } | null;
  qualityReason: PhotoReason | null; replacesId: string | null; supersededAt: string | null;
}
export interface IdentityEvent {
  id: string; photoId: string | null; action: string; details: string | null;
  actor: { id: number; name: string }; createdAt: string;
}
export const getIdentityContext = (signal?: AbortSignal) => customFetch<IdentityContext>(`${base()}/context`, { signal, cache: "no-store" });
export const getIdentityPhotos = (hireId: number, signal?: AbortSignal) =>
  customFetch<{ photos: IdentityPhoto[]; events: IdentityEvent[] }>(`${base()}?hireId=${hireId}`, { signal, cache: "no-store" });
export const linkIdentityHire = (hireId: number, staffId: number) =>
  customFetch(`${base()}/hires/${hireId}/employee`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ staffId }) });
export const reviewIdentityPhoto = (id: string, status: "reviewed" | "needs_clearer_photo", reason?: PhotoReason) =>
  customFetch(`${base()}/${id}/review`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, ...(reason ? { reason } : {}) }) });
export async function getIdentityPhotoBlob(id: string, signal?: AbortSignal): Promise<Blob> {
  return customFetch<Blob>(`${base()}/${id}/image`, { signal, responseType: "blob", cache: "no-store" });
}
export function identityFileType(file: File): string {
  const supported = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  if (supported.includes(file.type.toLowerCase())) return file.type.toLowerCase();
  // Some iPhones omit MIME for HEIC selections. Never infer arbitrary formats.
  if (!file.type && /\.heic$/i.test(file.name)) return "image/heic";
  if (!file.type && /\.heif$/i.test(file.name)) return "image/heif";
  throw new Error("Choose a JPEG, PNG, WebP, HEIC or HEIF photograph.");
}
export async function uploadIdentityPhoto(
  input: { hireId: number; category: IdentityCategory; side: IdentitySide; replacesId: string | null },
  file: File,
  options: { signal?: AbortSignal; onProgress?: (percent: number) => void } = {},
): Promise<IdentityPhoto> {
  if (!file.size || file.size > IDENTITY_MAX_BYTES) throw new Error("Photographs must be between 1 byte and 8 MB.");
  const contentType = identityFileType(file);
  const ticket = await customFetch<{ id: string; uploadURL: string }>(`${base()}/uploads`, {
    method: "POST", signal: options.signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, size: file.size, contentType }),
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const abort = () => xhr.abort();
      const done = () => options.signal?.removeEventListener("abort", abort);
      xhr.open("PUT", ticket.uploadURL);
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) options.onProgress?.(Math.round(event.loaded / event.total * 90));
      };
      xhr.onload = () => { done(); xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Photo transfer failed. Please retry.")); };
      xhr.onerror = () => { done(); reject(new Error("Photo transfer failed. Check your connection and retry.")); };
      xhr.onabort = () => { done(); reject(new DOMException("Upload cancelled", "AbortError")); };
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) { done(); reject(new DOMException("Upload cancelled", "AbortError")); return; }
      xhr.send(file);
    });
    options.onProgress?.(95);
    // Commit is idempotent. Once transfer ends, let the server finish validation
    // even if a component unmounts, rather than cancelling an uncertain save.
    let photo: IdentityPhoto;
    try {
      photo = await customFetch<IdentityPhoto>(`${base()}/uploads/${ticket.id}/complete`, { method: "POST" });
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status && status < 500) throw error;
      // Recover an uncertain response using the same idempotent ticket,
      // rather than accidentally uploading a duplicate replacement.
      photo = await customFetch<IdentityPhoto>(`${base()}/uploads/${ticket.id}/complete`, { method: "POST" });
    }
    options.onProgress?.(100);
    return photo;
  } catch (error) {
    // A successful commit is never deleted; this endpoint only removes pending tickets.
    await customFetch(`${base()}/uploads/${ticket.id}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}
