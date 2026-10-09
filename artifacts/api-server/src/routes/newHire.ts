import { Router, type IRouter } from "express";
import { promotedCandidateFromRequest } from "../lib/actorSession";
import { PROMOTED_CANDIDATE_FORM_IDS } from "../lib/onboardingCandidatePolicy";

const router: IRouter = Router();

router.get("/new-hire/status", async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const candidate = await promotedCandidateFromRequest(req);
    if (!candidate) {
      res.status(403).json({ error: "A manager-approved new-hire record is required" });
      return;
    }
    res.json({
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      email: candidate.email,
      phone: candidate.phone,
      position: candidate.position,
      formIds: [...PROMOTED_CANDIDATE_FORM_IDS],
    });
  } catch {
    res.status(503).json({ error: "Identity verification is temporarily unavailable" });
  }
});

export default router;
