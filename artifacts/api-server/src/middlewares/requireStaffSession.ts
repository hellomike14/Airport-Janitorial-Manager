import { getAuth } from "@clerk/express";
import { actorStaffFromRequest } from "../lib/actorSession";
import { promotedCandidateFromRequest } from "../lib/actorSession";
import { isPromotedCandidateRequest } from "../lib/onboardingCandidatePolicy";
import { createStaffSessionGate } from "./staffSessionGate";

export const requireStaffSession = createStaffSessionGate(
  req => !!getAuth(req)?.userId,
  actorStaffFromRequest,
  req => isPromotedCandidateRequest(req.path, req.method, req.query)
    ? promotedCandidateFromRequest(req)
    : Promise.resolve(null),
);
