import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import {
  normalizeContentType,
  privateObjectServingPolicy,
  uploadRecordMetadata,
  verifiedUploadRecordFromMetadata,
  type StoredObjectMetadata,
  type UploadCapability,
  type VerifiedUploadRecord,
} from "./secureUpload";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}
export class UnsafeObjectError extends Error {
  constructor() {
    super("Object metadata is not safe to serve");
    this.name = "UnsafeObjectError";
    Object.setPrototypeOf(this, UnsafeObjectError.prototype);
  }
}

type DownloadObjectOptions =
  | { visibility: "public"; cacheTtlSec?: number }
  | {
      visibility: "private";
      metadata?: StoredObjectMetadata;
      verifiedRecord?: VerifiedUploadRecord | null;
    };

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(
    file: File,
    options: DownloadObjectOptions,
  ): Promise<Response> {
    const [rawMetadata] =
      options.visibility === "private" && options.metadata
        ? [options.metadata]
        : await file.getMetadata();
    const metadata = rawMetadata as StoredObjectMetadata;

    let headers: Record<string, string>;
    if (options.visibility === "private") {
      const policy = privateObjectServingPolicy(
        metadata,
        options.verifiedRecord ?? null,
      );
      if (!policy) throw new UnsafeObjectError();
      headers = policy.headers;
    } else {
      const contentType = normalizeContentType(metadata.contentType) ?? "application/octet-stream";
      headers = {
        "Content-Type": contentType,
        "Cache-Control": `public, max-age=${options.cacheTtlSec ?? 3600}`,
        "X-Content-Type-Options": "nosniff",
      };
      const size = Number(metadata.size);
      if (Number.isSafeInteger(size) && size >= 0) {
        headers["Content-Length"] = String(size);
      }
    }

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    return new Response(webStream, { headers });
  }

  createObjectEntityPath(): string {
    return `/objects/uploads/${randomUUID()}`;
  }

  async saveObjectEntityUpload(
    capability: UploadCapability,
    data: Buffer,
  ): Promise<void> {
    const file = this.objectFileForEntityPath(capability.objectPath);
    await file.save(data, {
      resumable: false,
      contentType: capability.contentType,
      metadata: {
        contentType: capability.contentType,
        metadata: uploadRecordMetadata(capability),
      },
      preconditionOpts: { ifGenerationMatch: 0 },
      validation: "crc32c",
    });
  }

  async inspectObjectEntity(
    objectPath: string,
  ): Promise<{
    file: File;
    metadata: StoredObjectMetadata;
    verifiedRecord: VerifiedUploadRecord | null;
  }> {
    const file = await this.getObjectEntityFile(objectPath);
    const [rawMetadata] = await file.getMetadata();
    const metadata = rawMetadata as StoredObjectMetadata;
    return {
      file,
      metadata,
      verifiedRecord: verifiedUploadRecordFromMetadata(objectPath, metadata),
    };
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    const objectFile = this.objectFileForEntityPath(objectPath);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  private objectFileForEntityPath(objectPath: string): File {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const parts = objectPath.slice(1).split("/");
    if (
      parts.length < 2 ||
      parts.some((part) => !part || part === "." || part === "..")
    ) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir = `${entityDir}/`;
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    return objectStorageClient.bucket(bucketName).file(objectName);
  }

}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}
