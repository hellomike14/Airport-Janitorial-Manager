import { Router, type IRouter } from "express";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireStaffRole } from "../middlewares/requireStaffRole";
import { parseVideoRange } from "../lib/videoRange";
import { employeeTraining } from "../lib/employeeTrainingConfig";
import acknowledgmentsRouter from "./trainingAcknowledgments";

// Logical private-object path, not a signed URL or a deployment-local file.
export const EMPLOYEE_TRAINING_OBJECT = employeeTraining.objectPath;

const router: IRouter = Router();
const storage = new ObjectStorageService();
router.use("/employee-training", acknowledgmentsRouter);

// The parent API router requires a verified, active staff session for every request,
// including HEAD and subsequent range requests. Inspectors do not have this portal.
router.get("/employee-training/video", requireStaffRole("admin", "supervisor", "staff"), async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.query.format !== undefined && req.query.format !== "webm" && req.query.format !== "mp4") {
    res.status(400).json({ error: "Unsupported training video format" });
    return;
  }
  const webm = req.query.format === "webm";
  try {
    const file = await storage.getObjectEntityFile(webm ? employeeTraining.webmObjectPath : EMPLOYEE_TRAINING_OBJECT);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new Error("Training video has invalid storage metadata");
    }
    const range = parseVideoRange(req.headers.range, size);
    res.setHeader("Accept-Ranges", "bytes");
    if (range === false) {
      res.setHeader("Content-Range", `bytes */${size}`);
      res.status(416).end();
      return;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    res.setHeader("Content-Type", webm ? "video/webm" : "video/mp4");
    res.setHeader("Content-Length", end - start + 1);
    if (range) res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.status(range ? 206 : 200);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = file.createReadStream({ start, end });
    res.on("close", () => stream.destroy());
    stream.on("error", () => {
      console.error("Employee training video stream failed");
      if (!res.headersSent) {
        res.removeHeader("Content-Length");
        res.removeHeader("Content-Range");
        res.status(503).json({ error: "Training video temporarily unavailable" });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  } catch (error) {
    console.error("Employee training video unavailable");
    res.status(error instanceof ObjectNotFoundError ? 404 : 503)
      .json({ error: "Training video temporarily unavailable" });
  }
});

export default router;
