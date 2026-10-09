import { getOnboardingFormTemplate } from "./onboardingFormAssets";

export const PUBLIC_APPLICANT_FORM_IDS = new Set(["job-application", "i-9", "w-4"]);

// Only candidate-facing onboarding forms are available after a manager has
// explicitly promoted the application. Supervisor/admin and HR-only templates
// remain staff-only.
export const PROMOTED_CANDIDATE_FORM_IDS = new Set([
  "i-9",
  "w-4",
  "offer-acceptance",
  "emergency-contact",
  "language-accessibility",
  "orientation-acknowledgment",
  "video-attestation",
  "knowledge-check",
  "badge-rules-acknowledgment",
]);

export function isPromotedCandidateFormId(formId: string): boolean {
  if (!PROMOTED_CANDIDATE_FORM_IDS.has(formId)) return false;
  if (formId === "i-9" || formId === "w-4") return true;
  const template = getOnboardingFormTemplate(formId);
  return Boolean(template && !template.restricted);
}

export function isPromotedCandidateRequest(path: string, method: string, query: unknown = {}): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const queryValues = typeof query === "object" && query !== null ? query as Record<string, unknown> : {};
  const queryKeys = Object.keys(queryValues);
  if (path === "/new-hire/status") return queryKeys.length === 0;
  if (path === "/employee-training/video") {
    const format = queryValues.format;
    return queryKeys.every(key => key === "format") &&
      (format === undefined || format === "webm" || format === "mp4");
  }
  const match = path.match(/^\/employment-forms\/([^/]+)\/?$/i);
  if (!match || queryKeys.length > 0) return false;
  return isPromotedCandidateFormId(match[1]!.toLowerCase());
}
