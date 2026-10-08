import {
  getEmploymentFormTemplate,
  getEmploymentI9Form,
  getEmploymentJobApplication,
  getEmploymentW4Form,
} from "@workspace/api-client-react";
import type { EmploymentFormId, EmploymentTemplateId } from "../onboardingFormCatalog";

export type { EmploymentFormId, EmploymentTemplateId } from "../onboardingFormCatalog";

// Generated helpers use customFetch (existing auth/cookies). Ask for a blob explicitly.
const blobOpts = (signal: AbortSignal) => ({ signal, responseType: "blob" }) as RequestInit;
type ExistingFormId = "job-application" | "i-9" | "w-4";
const loaders: Record<ExistingFormId, (signal: AbortSignal) => Promise<Blob>> = {
  "job-application": (s) => getEmploymentJobApplication(undefined, blobOpts(s)),
  "i-9": (s) => getEmploymentI9Form(undefined, blobOpts(s)),
  "w-4": (s) => getEmploymentW4Form(undefined, blobOpts(s)),
};

export async function fetchFormBytes(id: EmploymentTemplateId, signal: AbortSignal): Promise<Uint8Array> {
  const existingLoader = loaders[id as ExistingFormId];
  const blob = existingLoader
    ? await existingLoader(signal)
    : await getEmploymentFormTemplate(id, undefined, blobOpts(signal));
  if (!(blob instanceof Blob)) throw new Error("Unexpected form response");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("Response was not a PDF");
  return bytes;
}
