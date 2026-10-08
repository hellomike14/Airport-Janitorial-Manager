import { Router, type IRouter, type RequestHandler } from "express";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { requireStaffRole } from "../middlewares/requireStaffRole";
import {
  EmailEmploymentBlankFormBody,
  EmailEmploymentBlankFormParams,
  GetEmploymentFormTemplateParamsSchema,
  GetEmploymentFormTemplateQueryParams,
} from "@workspace/api-zod";
import {
  getOnboardingCompanyForms,
  getOnboardingFormTemplate,
  ONBOARDING_INDEX_ID,
  readOnboardingFormTemplate,
} from "../lib/onboardingFormAssets";
import {
  MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES,
  sendEmploymentFormEmail,
  type EmploymentEmailSender,
} from "../lib/employmentFormEmail";

type EmploymentTemplate = {
  filename: string;
  restricted: boolean;
  objectPath?: string;
};

const forms = new Map<string, EmploymentTemplate>([
  ["job-application", {
    objectPath: "/objects/uploads/354716d4-2967-439f-a9f3-ac4bf6ad01e8",
    filename: "Marvol_Fillable_Job_Application_April_2026.pdf",
    restricted: false,
  }],
  ["i-9", {
    objectPath: "/objects/uploads/8a6c3ec0-65c4-4301-8abe-232454503365",
    filename: "Form_I-9_Fillable.pdf",
    restricted: false,
  }],
  ["w-4", {
    objectPath: "/objects/uploads/979c8345-1282-41d9-b526-5295bbb31be7",
    filename: "Form_W-4_2026_Fillable.pdf",
    restricted: false,
  }],
]);
for (const form of getOnboardingCompanyForms()) {
  if (forms.has(form.id)) throw new Error(`Duplicate employment form id: ${form.id}`);
  forms.set(form.id, { filename: form.filename, restricted: form.restricted });
}
const indexTemplate = getOnboardingFormTemplate(ONBOARDING_INDEX_ID);
if (!indexTemplate || forms.has(ONBOARDING_INDEX_ID)) {
  throw new Error("Onboarding form index is missing or duplicated");
}
forms.set(ONBOARDING_INDEX_ID, { filename: indexTemplate.filename, restricted: false });
const pdfSignature = Buffer.from("%PDF-");
const emailUnavailableMessage = "The blank form could not be emailed. Please try again.";
const emailRateWindowMs = 10 * 60_000;
const emailRateMax = 5;

type EmploymentFormsStorage = Pick<
  ObjectStorageService,
  "getObjectEntityFile" | "getObjectEntityMetadata" | "readObjectEntityBytes"
>;

function createPublicTemplateEmailRateLimit(): RequestHandler {
  const attempts = new Map<string, { startedAt: number; count: number }>();
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    for (const [address, attempt] of attempts) {
      if (now - attempt.startedAt >= emailRateWindowMs) attempts.delete(address);
    }
    const current = attempts.get(key);
    if (!current || now - current.startedAt >= emailRateWindowMs) {
      attempts.set(key, { startedAt: now, count: 1 });
      next();
      return;
    }
    if (current.count >= emailRateMax) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((emailRateWindowMs - (now - current.startedAt)) / 1000))));
      res.status(429).json({ error: "Too many blank form emails. Please try again later." });
      return;
    }
    current.count++;
    next();
  };
}

function recordEmailOutcome(
  req: Parameters<RequestHandler>[0],
  outcome: "accepted" | "failed",
  reason?: string,
) {
  const fields = {
    feature: "employment_blank_form_email",
    outcome,
    ...(reason ? { reason } : {}),
  };
  if (outcome === "accepted") req.log?.info(fields, "Blank employment form email accepted");
  else req.log?.error(fields, "Blank employment form email failed");
}

export const isEmploymentFormObjectPath = (path: string) =>
  [...forms.values()].some(form => form.objectPath === path);

function getTemplateIdFromPath(path: string, suffix: "template" | "email"): string | null {
  const pattern = suffix === "template"
    ? /^\/employment-forms\/([^/]+)\/?$/i
    : /^\/employment-forms\/([^/]+)\/email\/?$/i;
  return path.match(pattern)?.[1]?.toLowerCase() ?? null;
}

export function isPublicBlankEmploymentTemplate(path: string, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { return false; }
  const id = getTemplateIdFromPath(decoded, "template");
  if (id && forms.get(id)?.restricted === false) return true;
  const prefix = "/storage/objects/";
  if (!decoded.toLowerCase().startsWith(prefix)) return false;
  const objectPath = `/objects/${decoded.slice(prefix.length)}`;
  return isEmploymentFormObjectPath(objectPath);
}

export function isPublicBlankEmploymentEmail(path: string, method: string): boolean {
  if (method !== "POST") return false;
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { return false; }
  const id = getTemplateIdFromPath(decoded, "email");
  return id !== null && forms.get(id)?.restricted === false;
}

export function createEmploymentFormsRouter(
  storage: EmploymentFormsStorage = new ObjectStorageService(),
  authorize: RequestHandler = (_req, _res, next) => next(),
  sendEmail: EmploymentEmailSender = sendEmploymentFormEmail,
): IRouter {
  const router: IRouter = Router();
  const rateLimitBlankEmail = createPublicTemplateEmailRateLimit();
  const authorizeRestrictedTemplate: RequestHandler = (req, res, next) => {
    const rawId = Array.isArray(req.params.formId) ? req.params.formId[0] : req.params.formId;
    const template = typeof rawId === "string" ? forms.get(rawId) : undefined;
    if (!template?.restricted) { next(); return; }
    return requireStaffRole("admin")(req, res, next);
  };
  router.get("/employment-forms/:formId", authorize, authorizeRestrictedTemplate, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const id = GetEmploymentFormTemplateParamsSchema.safeParse(req.params);
    if (!id.success) {
      res.status(404).json({ error: "Employment form not found" });
      return;
    }
    const parsed = GetEmploymentFormTemplateQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid download option" });
      return;
    }
    const form = forms.get(id.data.formId);
    if (!form) {
      res.status(404).json({ error: "Employment form not found" });
      return;
    }
    try {
      const pdf = form.objectPath
        ? (await (await storage.getObjectEntityFile(form.objectPath)).download())[0]
        : await readOnboardingFormTemplate(id.data.formId);
      if (!pdf) throw new Error("EMPTY_FORM_PDF");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `${parsed.data.download ? "attachment" : "inline"}; filename="${form.filename}"`);
      res.send(pdf);
    } catch (error) {
      req.log?.error({ formId: id.data.formId }, "Employment form PDF could not be retrieved");
      res.status(error instanceof ObjectNotFoundError ? 404 : 503)
        .json({ error: "The form PDF is unavailable. Please try again." });
    }
  });

  router.post(
    "/employment-forms/:formId/email",
    authorize,
    authorizeRestrictedTemplate,
    rateLimitBlankEmail,
    async (req, res): Promise<void> => {
      res.setHeader("Cache-Control", "no-store");
      const params = EmailEmploymentBlankFormParams.safeParse(req.params);
      if (!params.success) {
        recordEmailOutcome(req, "failed", "form_not_found");
        res.status(404).json({ error: "Employment form not found." });
        return;
      }
      const body = EmailEmploymentBlankFormBody.strict().safeParse(req.body);
      if (!body.success) {
        recordEmailOutcome(req, "failed", "invalid_request");
        res.status(400).json({ error: "Enter a valid recipient email address." });
        return;
      }

      const form = forms.get(params.data.formId);
      if (!form) {
        recordEmailOutcome(req, "failed", "form_not_found");
        res.status(404).json({ error: "Employment form not found." });
        return;
      }
      let pdf: Buffer;
      try {
        if (form.objectPath) {
          const metadata = await storage.getObjectEntityMetadata(form.objectPath);
          if (metadata.sizeBytes <= 0 || metadata.sizeBytes > MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES) {
            recordEmailOutcome(req, "failed", "attachment_too_large");
            res.status(413).json({ error: "The blank form is too large to email." });
            return;
          }
          const stored = await storage.readObjectEntityBytes(form.objectPath, MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES);
          pdf = Buffer.from(stored.bytes);
          if (stored.sizeBytes !== pdf.byteLength ||
              stored.sizeBytes > MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES ||
              stored.contentType !== "application/pdf") {
            throw new Error("INVALID_STORED_PDF");
          }
        } else {
          pdf = await readOnboardingFormTemplate(params.data.formId);
          if (pdf.byteLength <= 0 || pdf.byteLength > MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES) {
            recordEmailOutcome(req, "failed", "attachment_too_large");
            res.status(413).json({ error: "The blank form is too large to email." });
            return;
          }
        }
      } catch (error) {
        recordEmailOutcome(req, "failed", error instanceof ObjectNotFoundError ? "pdf_missing" : "pdf_unavailable");
        res.status(error instanceof ObjectNotFoundError ? 404 : 503).json({ error: emailUnavailableMessage });
        return;
      }

      if (pdf.byteLength < pdfSignature.byteLength || !pdf.subarray(0, pdfSignature.byteLength).equals(pdfSignature)) {
        recordEmailOutcome(req, "failed", "invalid_pdf");
        res.status(503).json({ error: emailUnavailableMessage });
        return;
      }
      try {
        await sendEmail({
          to: body.data.recipientEmail,
          subject: `Marvol blank ${form.filename.replace(/\.pdf$/i, "").replaceAll("_", " ")}`,
          text: "The requested blank Marvol employment form PDF is attached.",
          attachments: [{ filename: form.filename, contentType: "application/pdf", bytes: pdf }],
        });
        recordEmailOutcome(req, "accepted");
        res.status(202).json({ accepted: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const configurationError = message === "EMPLOYMENT_EMAIL_NOT_CONFIGURED";
        const tooLarge = message === "EMPLOYMENT_EMAIL_ATTACHMENTS_TOO_LARGE";
        const invalidRecipient = message === "EMPLOYMENT_EMAIL_INVALID_RECIPIENT";
        const providerRejected = message.startsWith("EMPLOYMENT_EMAIL_REJECTED_");
        recordEmailOutcome(
          req,
          "failed",
          configurationError ? "email_not_configured" : tooLarge ? "attachment_too_large" : invalidRecipient ? "invalid_recipient" : providerRejected ? "provider_rejected" : "provider_unavailable",
        );
        const status = configurationError ? 503 : tooLarge ? 413 : invalidRecipient ? 400 : providerRejected ? 502 : 502;
        const messageText = configurationError
          ? "Email delivery is not configured."
          : tooLarge
            ? "The blank form is too large to email."
            : invalidRecipient
              ? "Enter a valid recipient email address."
              : emailUnavailableMessage;
        res.status(status).json({ error: messageText });
      }
    },
  );
  return router;
}

export default createEmploymentFormsRouter();
