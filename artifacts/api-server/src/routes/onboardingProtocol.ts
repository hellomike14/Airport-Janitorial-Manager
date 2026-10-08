import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { requireStaffRole } from "../middlewares/requireStaffRole";
import { EmailOnboardingProtocolBody, type OnboardingProtocolEmailResponse } from "@workspace/api-zod";
import {
  MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES,
  sendEmploymentFormEmail,
  type EmploymentEmailSender,
} from "../lib/employmentFormEmail";

const objectPath = "/objects/uploads/61d217bf-00af-4626-bd97-a84405b38a63";
const filename = "Marvol_Employee_Onboarding_Protocol_v1.pdf";
const options = z.object({ download: z.enum(["1"]).optional() });
const emailResponse: OnboardingProtocolEmailResponse = { accepted: true };
const pdfSignature = Buffer.from("%PDF-");
const emailUnavailableMessage = "The onboarding protocol could not be emailed. Please try again.";
const pdfUnavailableMessage = "The onboarding protocol is unavailable. Please try again.";

type OnboardingProtocolStorage = Pick<
  ObjectStorageService,
  "getObjectEntityFile" | "getObjectEntityMetadata" | "readObjectEntityBytes"
>;

function recordEmailOutcome(
  req: Parameters<RequestHandler>[0],
  outcome: "accepted" | "failed",
  reason?: string,
  attachmentBytes?: number,
) {
  const fields = {
    feature: "onboarding_protocol_email",
    outcome,
    ...(reason ? { reason } : {}),
    ...(attachmentBytes === undefined ? {} : { attachmentBytes }),
  };
  if (outcome === "accepted") req.log?.info(fields, "Onboarding protocol email accepted");
  else req.log?.error(fields, "Onboarding protocol email failed");
}

export function createOnboardingProtocolRouter(
  storage: OnboardingProtocolStorage = new ObjectStorageService(),
  authorize: RequestHandler = requireStaffRole("admin", "supervisor", "staff", "inspector"),
  authorizeEmail: RequestHandler = requireStaffRole("admin"),
  sendEmail: EmploymentEmailSender = sendEmploymentFormEmail,
): IRouter {
  const router = Router();
  router.get("/onboarding-protocol", authorize, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const parsed = options.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid download option" });
      return;
    }
    try {
      const file = await storage.getObjectEntityFile(objectPath);
      const [pdf] = await file.download();
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `${parsed.data.download ? "attachment" : "inline"}; filename="${filename}"`);
      res.send(pdf);
    } catch (error) {
      req.log?.error(
        { feature: "onboarding_protocol", reason: error instanceof ObjectNotFoundError ? "pdf_missing" : "pdf_unavailable" },
        "Onboarding protocol PDF could not be retrieved",
      );
      res.status(error instanceof ObjectNotFoundError ? 404 : 503)
        .json({ error: pdfUnavailableMessage });
    }
  });

  router.post("/onboarding-protocol/email", authorizeEmail, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const parsed = EmailOnboardingProtocolBody.strict().safeParse(req.body);
    if (!parsed.success) {
      recordEmailOutcome(req, "failed", "invalid_request");
      res.status(400).json({ error: "Enter a valid recipient email address." });
      return;
    }

    let pdf: Buffer;
    try {
      const metadata = await storage.getObjectEntityMetadata(objectPath);
      if (metadata.sizeBytes > MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES) {
        recordEmailOutcome(req, "failed", "attachment_too_large");
        res.status(413).json({ error: "The onboarding protocol is too large to email." });
        return;
      }
      const stored = await storage.readObjectEntityBytes(objectPath, MAX_EMPLOYMENT_EMAIL_ATTACHMENT_BYTES);
      pdf = Buffer.from(stored.bytes);
    } catch (error) {
      recordEmailOutcome(
        req,
        "failed",
        error instanceof ObjectNotFoundError ? "pdf_missing" : "pdf_unavailable",
      );
      res.status(503).json({ error: pdfUnavailableMessage });
      return;
    }

    if (pdf.byteLength < pdfSignature.byteLength || !pdf.subarray(0, pdfSignature.byteLength).equals(pdfSignature)) {
      recordEmailOutcome(req, "failed", "invalid_pdf");
      res.status(503).json({ error: pdfUnavailableMessage });
      return;
    }

    try {
      await sendEmail({
        to: parsed.data.recipientEmail,
        subject: "Marvol Employee Onboarding Protocol",
        text: "The current Marvol Employee Onboarding Protocol PDF is attached.",
        attachments: [{
          filename,
          contentType: "application/pdf",
          bytes: pdf,
        }],
      });
      recordEmailOutcome(req, "accepted", undefined, pdf.byteLength);
      res.status(202).json(emailResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const configurationError = message === "EMPLOYMENT_EMAIL_NOT_CONFIGURED";
      const tooLarge = message === "EMPLOYMENT_EMAIL_ATTACHMENTS_TOO_LARGE";
      const invalidRecipient = message === "EMPLOYMENT_EMAIL_INVALID_RECIPIENT";
      const reason = configurationError
        ? "email_not_configured"
        : tooLarge
          ? "attachment_too_large"
          : invalidRecipient
            ? "invalid_recipient"
            : message.startsWith("EMPLOYMENT_EMAIL_REJECTED_")
              ? "provider_rejected"
              : "provider_unavailable";
      recordEmailOutcome(req, "failed", reason);
      const status = configurationError ? 503 : tooLarge ? 413 : invalidRecipient ? 400 : 502;
      const errorMessage = configurationError
        ? "Email delivery is not configured."
        : tooLarge
          ? "The onboarding protocol is too large to email."
          : invalidRecipient
            ? "Enter a valid recipient email address."
            : emailUnavailableMessage;
      res.status(status).json({ error: errorMessage });
    }
  });

  return router;
}

export default createOnboardingProtocolRouter();
