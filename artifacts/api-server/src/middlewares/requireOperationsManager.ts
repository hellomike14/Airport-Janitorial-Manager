import type { NextFunction, Request, Response } from "express";
import {
  assertOperationsManager,
  ConfidentialError,
  confidentialIdentity,
} from "../lib/confidentialAccess";

export async function requireOperationsManager(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    assertOperationsManager(await confidentialIdentity(req));
    next();
  } catch (error) {
    if (error instanceof ConfidentialError) {
      res.status(error.status).json({
        error: error.code,
        code: error.code,
        message: error.message,
      });
      return;
    }
    next(error);
  }
}
