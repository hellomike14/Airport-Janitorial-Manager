import { Router, type IRouter } from "express";
import { sweepOverdueInspectorAssignments } from "../lib/inspectorTaskWorkflow";
import { verifyInternalCronSecret } from "../lib/sendgridEmailBridge";

const router: IRouter = Router();
router.post("/inspector-sla-sweep", async (req, res) => {
  const credential = req.header("x-internal-cron-secret") ?? req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!verifyInternalCronSecret(credential)) return res.status(401).json({ error: "Invalid cron credential" });
  await sweepOverdueInspectorAssignments();
  return res.status(202).json({ status: "sweep_complete" });
});
export default router;