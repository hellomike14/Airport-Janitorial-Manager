import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  ALLOWED_UPLOAD_CONTENT_TYPES,
  MAX_UPLOAD_BYTES,
  type UploadPurpose,
} from "./uploadRequestPolicy";

const CAPABILITY_VERSION = 1;
const MAX_CAPABILITY_LIFETIME_MS = 16 * 60 * 1000;
const DEVELOPMENT_SECRET = randomBytes(32);

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "text/plain": ".txt",
};

const CONTENT_TYPE_EXTENSION_ALIASES: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
};

export type UploadCapability = {
  v: 1;
  objectPath: string;
  name: string;
  size: number;
  contentType: string;
  purpose: UploadPurpose;
  ownerStaffId: number | null;
  exp: number;
};

export type VerifiedUploadRecord = Omit<UploadCapability, "v" | "exp"> & {
  version: 1;
};

export type StoredObjectMetadata = {
  contentType?: unknown;
  size?: unknown;
  metadata?: Record<string, unknown> | null;
};

export type PrivateObjectServingPolicy = {
  contentType: string;
  size: number;
  contentDisposition: string;
  headers: Record<string, string>;
};

function uploadSecret(): Buffer {
  const explicit = process.env.UPLOAD_TOKEN_SECRET?.trim();
  if (explicit) {
    if (explicit.length < 32) {
      throw new Error("UPLOAD_TOKEN_SECRET must contain at least 32 characters");
    }
    return Buffer.from(explicit, "utf8");
  }

  // Production already requires CLERK_SECRET_KEY. Derive a purpose-separated
  // key so upload capabilities work without introducing a deployment-breaking
  // secret migration, while allowing an independently rotated key above.
  const clerkSecret = process.env.CLERK_SECRET_KEY?.trim();
  if (clerkSecret) {
    return createHmac("sha256", clerkSecret)
      .update("marvol-upload-capability-key-v1")
      .digest();
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("UPLOAD_TOKEN_SECRET or CLERK_SECRET_KEY is required in production");
  }
  return DEVELOPMENT_SECRET;
}

function hmac(domain: string, value: string): Buffer {
  return createHmac("sha256", uploadSecret())
    .update(domain)
    .update("\0")
    .update(value)
    .digest();
}

function safeSignatureEqual(expected: Buffer, actualEncoded: string): boolean {
  let actual: Buffer;
  try {
    actual = Buffer.from(actualEncoded, "base64url");
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(expected, actual);
}

function isUploadPurpose(value: unknown): value is UploadPurpose {
  return value === "staff-photo" || value === "application-document";
}

function isCanonicalObjectPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\/objects\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isCapability(value: unknown, now: number): value is UploadCapability {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UploadCapability>;
  return (
    candidate.v === CAPABILITY_VERSION &&
    isCanonicalObjectPath(candidate.objectPath) &&
    typeof candidate.name === "string" &&
    candidate.name.length >= 1 &&
    candidate.name.length <= 255 &&
    Number.isSafeInteger(candidate.size) &&
    (candidate.size ?? 0) >= 1 &&
    (candidate.size ?? 0) <= MAX_UPLOAD_BYTES &&
    typeof candidate.contentType === "string" &&
    ALLOWED_UPLOAD_CONTENT_TYPES.has(candidate.contentType) &&
    isUploadPurpose(candidate.purpose) &&
    (candidate.ownerStaffId === null ||
      (Number.isSafeInteger(candidate.ownerStaffId) && (candidate.ownerStaffId ?? 0) > 0)) &&
    Number.isSafeInteger(candidate.exp) &&
    (candidate.exp ?? 0) > now &&
    (candidate.exp ?? 0) <= now + MAX_CAPABILITY_LIFETIME_MS
  );
}

export function createUploadCapabilityToken(claims: UploadCapability): string {
  if (!isCapability(claims, Date.now() - 1)) {
    throw new Error("Invalid upload capability claims");
  }
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = hmac("capability", payload).toString("base64url");
  return `${payload}.${signature}`;
}

export function verifyUploadCapabilityToken(
  token: string,
  now = Date.now(),
): UploadCapability | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  if (!safeSignatureEqual(hmac("capability", payload), signature)) return null;

  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return isCapability(decoded, now) ? decoded : null;
  } catch {
    return null;
  }
}

function recordPayload(record: VerifiedUploadRecord): string {
  return JSON.stringify([
    record.version,
    record.objectPath,
    record.name,
    record.size,
    record.contentType,
    record.purpose,
    record.ownerStaffId,
  ]);
}

export function uploadRecordMetadata(
  capability: UploadCapability,
): Record<string, string> {
  const record: VerifiedUploadRecord = {
    version: 1,
    objectPath: capability.objectPath,
    name: capability.name,
    size: capability.size,
    contentType: capability.contentType,
    purpose: capability.purpose,
    ownerStaffId: capability.ownerStaffId,
  };
  return {
    marvoluploadversion: String(record.version),
    marvoluploadname: Buffer.from(record.name, "utf8").toString("base64url"),
    marvoluploadsize: String(record.size),
    marvoluploadcontenttype: record.contentType,
    marvoluploadpurpose: record.purpose,
    marvoluploadowner: record.ownerStaffId === null ? "" : String(record.ownerStaffId),
    marvoluploadsignature: hmac("record", recordPayload(record)).toString("base64url"),
  };
}

export function verifiedUploadRecordFromMetadata(
  objectPath: string,
  metadata: StoredObjectMetadata,
): VerifiedUploadRecord | null {
  const custom = metadata.metadata;
  if (!custom || typeof custom !== "object") return null;

  // Custom metadata passes through HTTP headers in some GCS operations, so
  // use lowercase keys and tolerate the earlier camel-case spelling.
  const field = (lowercase: string, camelCase: string): unknown =>
    custom[lowercase] ?? custom[camelCase];
  const version = Number(field("marvoluploadversion", "marvolUploadVersion"));
  const size = Number(field("marvoluploadsize", "marvolUploadSize"));
  const contentType = normalizeContentType(
    field("marvoluploadcontenttype", "marvolUploadContentType"),
  );
  const purpose = field("marvoluploadpurpose", "marvolUploadPurpose");
  const rawOwner = field("marvoluploadowner", "marvolUploadOwner");
  const ownerStaffId = rawOwner === "" ? null : Number(rawOwner);
  const encodedName = field("marvoluploadname", "marvolUploadName");
  const signature = field("marvoluploadsignature", "marvolUploadSignature");
  if (
    version !== 1 ||
    !isCanonicalObjectPath(objectPath) ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > MAX_UPLOAD_BYTES ||
    !contentType ||
    !isUploadPurpose(purpose) ||
    (ownerStaffId !== null && (!Number.isSafeInteger(ownerStaffId) || ownerStaffId <= 0)) ||
    typeof encodedName !== "string" ||
    typeof signature !== "string"
  ) {
    return null;
  }

  let name: string;
  try {
    name = Buffer.from(encodedName, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!name || name.length > 255) return null;

  const record: VerifiedUploadRecord = {
    version: 1,
    objectPath,
    name,
    size,
    contentType,
    purpose,
    ownerStaffId,
  };
  if (!safeSignatureEqual(hmac("record", recordPayload(record)), signature)) return null;

  // GCS-reported properties are authoritative for the bytes that are served.
  const storedType = normalizeContentType(metadata.contentType);
  const storedSize = Number(metadata.size);
  if (storedType !== record.contentType || storedSize !== record.size) return null;
  return record;
}

export function normalizeContentType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return normalized || null;
}

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  return bytes.every((byte, index) => buffer[index] === byte);
}

function isPlainText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify the actual bytes before they ever reach object storage. This is magic
 * number validation rather than trusting the browser's filename/MIME claim.
 * Documents are always downloaded as attachments, so accepting a generic ZIP
 * container for DOCX cannot create a same-origin execution surface.
 */
export function contentMatchesClaim(buffer: Buffer, claimedType: string): boolean {
  const type = normalizeContentType(claimedType);
  if (!type || buffer.length < 1) return false;
  switch (type) {
    case "image/jpeg":
      return startsWith(buffer, [0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp":
      return (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP"
      );
    case "image/heic":
    case "image/heif": {
      if (buffer.length < 12 || buffer.subarray(4, 8).toString("ascii") !== "ftyp") return false;
      const brand = buffer.subarray(8, 12).toString("ascii");
      return new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]).has(
        brand,
      );
    }
    case "application/pdf":
      return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
    case "application/msword":
      return startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]);
    case "text/plain":
      return isPlainText(buffer);
    default:
      return false;
  }
}

function safeDownloadName(name: string | undefined, contentType: string): string {
  const extension = CONTENT_TYPE_EXTENSIONS[contentType] ?? ".bin";
  const fallback = `${IMAGE_TYPES.has(contentType) ? "photo" : "download"}${extension}`;
  if (!name) return fallback;
  let cleaned = name
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f\\/]/g, "_")
    .replace(/[":;]/g, "_")
    .trim()
    .slice(0, 180);
  if (!cleaned) return fallback;
  const allowedExtensions = CONTENT_TYPE_EXTENSION_ALIASES[contentType] ?? [extension];
  if (!allowedExtensions.some((candidate) => cleaned.toLowerCase().endsWith(candidate))) {
    cleaned = `${cleaned}${extension}`;
  }
  return cleaned;
}

export function contentDisposition(name: string | undefined, contentType: string): string {
  const safeName = safeDownloadName(name, contentType);
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(safeName).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${IMAGE_TYPES.has(contentType) ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}

export function privateObjectServingPolicy(
  metadata: StoredObjectMetadata,
  verifiedRecord: VerifiedUploadRecord | null,
): PrivateObjectServingPolicy | null {
  const contentType = normalizeContentType(metadata.contentType);
  const size = Number(metadata.size);
  if (
    !contentType ||
    !ALLOWED_UPLOAD_CONTENT_TYPES.has(contentType) ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > MAX_UPLOAD_BYTES
  ) {
    return null;
  }
  if (
    verifiedRecord &&
    (verifiedRecord.contentType !== contentType || verifiedRecord.size !== size)
  ) {
    return null;
  }

  const disposition = contentDisposition(verifiedRecord?.name, contentType);
  return {
    contentType,
    size,
    contentDisposition: disposition,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Content-Disposition": disposition,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Frame-Options": "DENY",
    },
  };
}
