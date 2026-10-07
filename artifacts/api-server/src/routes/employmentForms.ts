import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { requireStaffRole } from "../middlewares/requireStaffRole";

const forms = {
  "job-application": {
    objectPath: "/objects/uploads/354716d4-2967-439f-a9f3-ac4bf6ad01e8",
    filename: "Marvol_Fillable_Job_Application_April_2026.pdf",
  },
  "i-9": {
    objectPath: "/objects/uploads/8a6c3ec0-65c4-4301-8abe-232454503365",
    filename: "Form_I-9_Fillable.pdf",
  },
  "w-4": {
    objectPath: "/objects/uploads/979c8345-1282-41d9-b526-5295bbb31be7",
    filename: "Form_W-4_2026_Fillable.pdf",
  },
};
const formId = z.enum(["job-application", "i-9", "w-4"]);
const options = z.object({ download: z.enum(["1"]).optional() });
export const isEmploymentFormObjectPath = (path: string) =>
  Object.values(forms).some(form => form.objectPath === path);
export function isPublicBlankEmploymentTemplate(path: string, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { return false; }
  const normalized = decoded.toLowerCase();
  if (/^\/employment-forms\/(?:job-application|i-9|w-4)\/?$/.test(normalized)) return true;
  const prefix = "/storage/objects/";
  if (!normalized.startsWith(prefix)) return false;
  const objectPath = `/objects/${decoded.slice(prefix.length)}`;
  return isEmploymentFormObjectPath(objectPath);
}

export function createEmploymentFormsRouter(
  storage: Pick<ObjectStorageService, "getObjectEntityFile"> = new ObjectStorageService(),
  authorize: RequestHandler = (_req, _res, next) => next(),
): IRouter {
  const router: IRouter = Router();
  router.get("/employment-forms/:formId", authorize, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const id = formId.safeParse(req.params.formId);
    if (!id.success) {
      res.status(404).json({ error: "Employment form not found" });
      return;
    }
    const parsed = options.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid download option" });
      return;
    }
    const form = forms[id.data];
    try {
      const file = await storage.getObjectEntityFile(form.objectPath);
      const [pdf] = await file.download();
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `${parsed.data.download ? "attachment" : "inline"}; filename="${form.filename}"`);
      res.send(pdf);
    } catch (error) {
      console.error("Employment form PDF could not be retrieved");
      res.status(error instanceof ObjectNotFoundError ? 404 : 503)
        .json({ error: "The form PDF is unavailable. Please try again." });
    }
  });
  return router;
}

export default createEmploymentFormsRouter();
