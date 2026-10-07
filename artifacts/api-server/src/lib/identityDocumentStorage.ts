import { createHash } from "node:crypto";
import { ObjectStorageService, objectStorageClient } from "./objectStorage";
import { IdentityDocumentError, MAX_IDENTITY_BYTES } from "./identityPhotoProcessing";

const service = new ObjectStorageService();
export const identityDocumentStorage = {
  async reserve() {
    const uploadURL = await service.getObjectEntityUploadURL("hr-identity/staging");
    return { uploadURL, stagingPath: service.normalizeObjectEntityPath(uploadURL) };
  },
  async readStaging(path: string, expectedBytes: number) {
    const file = await service.getObjectEntityFile(path);
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) !== expectedBytes || Number(metadata.size) > MAX_IDENTITY_BYTES) {
      throw new IdentityDocumentError(400, "The uploaded photo size does not match. Choose the photo again and retry.");
    }
    const [bytes] = await file.download();
    if (bytes.length !== expectedBytes) throw new IdentityDocumentError(400, "Incomplete photograph. Please retry.");
    return bytes;
  },
  async save(id: string, kind: "original" | "image", bytes: Buffer, contentType: string) {
    const path = `/objects/hr-identity/${kind}/${id}`;
    const dir = service.getPrivateObjectDir().replace(/\/$/, "");
    const full = `${dir}/hr-identity/${kind}/${id}`;
    const slash = full.indexOf("/", 1);
    const file = objectStorageClient.bucket(full.slice(1, slash)).file(full.slice(slash + 1));
    try {
      await file.save(bytes, {
        resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType, cacheControl: "private, no-store" },
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 412) throw error;
      const [existing] = await file.download();
      if (hash(existing) !== hash(bytes)) throw new IdentityDocumentError(409, "This upload changed while saving. Refresh and submit a new photograph.");
    }
    return path;
  },
  async readImage(path: string) {
    const [bytes] = await (await service.getObjectEntityFile(path)).download();
    return bytes;
  },
  async removeStaging(path: string) {
    try { await (await service.getObjectEntityFile(path)).delete({ ignoreNotFound: true }); } catch { /* no submitted records are removed */ }
  },
};
export function hash(bytes: Buffer) { return createHash("sha256").update(bytes).digest("hex"); }
