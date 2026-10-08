import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { requireStaffRole } from "../middlewares/requireStaffRole";

const objectPath = "/objects/uploads/61d217bf-00af-4626-bd97-a84405b38a63";
const filename = "Marvol_Employee_Onboarding_Protocol_v1.pdf";
const options = z.object({ download: z.enum(["1"]).optional() });

export function createOnboardingProtocolRouter(
  storage: Pick<ObjectStorageService, "getObjectEntityFile"> = new ObjectStorageService(),
  authorize: RequestHandler = requireStaffRole("admin", "supervisor", "staff", "inspector"),
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
      console.error("Onboarding protocol PDF could not be retrieved");
      res.status(error instanceof ObjectNotFoundError ? 404 : 503)
        .json({ error: "The onboarding protocol is unavailable. Please try again." });
    }
  });
  return router;
}

export default createOnboardingProtocolRouter();
