const PUBLIC_UPLOAD_WINDOW_MS = 10 * 60 * 1000;
const PUBLIC_UPLOADS_PER_CLIENT = 10;
const PUBLIC_UPLOADS_GLOBAL = 60;

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
export const STAFF_PHOTO_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export const APPLICATION_DOCUMENT_CONTENT_TYPES = new Set([
  ...STAFF_PHOTO_CONTENT_TYPES,
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

export const ALLOWED_UPLOAD_CONTENT_TYPES = APPLICATION_DOCUMENT_CONTENT_TYPES;

export type UploadPurpose = "staff-photo" | "application-document";

type WindowEntry = { count: number; resetAt: number };

export type UploadRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Small fixed-window limiter for the intentionally public job-application
 * upload signer. The global ceiling prevents spoofed/rotating client keys from
 * minting an unlimited number of storage URLs on a single app instance.
 */
export class PublicUploadRateLimiter {
  private readonly windows = new Map<string, WindowEntry>();

  check(clientKey: string, now = Date.now()): UploadRateLimitResult {
    const global = this.consume("__global__", PUBLIC_UPLOADS_GLOBAL, now);
    if (!global.allowed) return global;

    const client = this.consume(`client:${clientKey}`, PUBLIC_UPLOADS_PER_CLIENT, now);
    if (!client.allowed) return client;

    if (this.windows.size > 1_000) {
      for (const [key, entry] of this.windows) {
        if (entry.resetAt <= now) this.windows.delete(key);
      }
    }

    return { allowed: true };
  }

  private consume(key: string, maximum: number, now: number): UploadRateLimitResult {
    const existing = this.windows.get(key);
    if (!existing || existing.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + PUBLIC_UPLOAD_WINDOW_MS });
      return { allowed: true };
    }

    if (existing.count >= maximum) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1_000)),
      };
    }

    existing.count += 1;
    return { allowed: true };
  }
}

export function validateUploadMetadata(input: {
  name: string;
  size: number;
  contentType: string;
  purpose: UploadPurpose;
}): string | null {
  if (input.name.trim().length === 0 || input.name.length > 255) {
    return "File name must be between 1 and 255 characters";
  }
  if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_UPLOAD_BYTES) {
    return `File size must be between 1 byte and ${MAX_UPLOAD_BYTES} bytes`;
  }
  const normalizedType = input.contentType.trim().toLowerCase();
  const allowedTypes =
    input.purpose === "staff-photo"
      ? STAFF_PHOTO_CONTENT_TYPES
      : APPLICATION_DOCUMENT_CONTENT_TYPES;
  if (!allowedTypes.has(normalizedType)) {
    return "File type is not allowed";
  }
  return null;
}
