import { getAuth } from "@clerk/express";
import { actorStaffFromRequest } from "../lib/actorSession";
import { createStaffSessionGate } from "./staffSessionGate";

export const requireStaffSession = createStaffSessionGate(req => !!getAuth(req)?.userId, actorStaffFromRequest);
