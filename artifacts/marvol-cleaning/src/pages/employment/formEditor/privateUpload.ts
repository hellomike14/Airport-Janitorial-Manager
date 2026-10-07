import { requestUploadUrl } from "@workspace/api-client-react";
import type { ApplicationUploadDocument } from "@workspace/api-client-react";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export async function uploadEmploymentFormFile(file: File): Promise<ApplicationUploadDocument> {
  if (!file.size || file.size > MAX_FILE_BYTES || !ALLOWED_TYPES.has(file.type)) {
    throw new Error("Unsupported employment form attachment");
  }
  const { uploadURL, objectPath, uploadToken } = await requestUploadUrl({
    name: file.name,
    size: file.size,
    contentType: file.type,
    purpose: "application_document",
  });
  if (!uploadToken) throw new Error("Upload capability was not returned");
  const response = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!response.ok) throw new Error("Employment form upload failed");
  return { name: file.name, path: objectPath, contentType: file.type, uploadToken };
}
