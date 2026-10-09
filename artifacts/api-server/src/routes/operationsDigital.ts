import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import {
  CreatePettyCashRecordBody,
  CreateUniformStockItemBody,
  CreateUniformStockTransactionBody,
  UpdatePettyCashRecordBody,
  UpdateUniformStockItemBody,
} from "@workspace/api-zod";
import { actorStaffFromRequest } from "../lib/actorSession";
import { DigitalOperationsError, requirePositiveId } from "../lib/digitalOperationsErrors";
import { pettyCashService, type PettyCashInput } from "../lib/pettyCash";
import { uniformStockService } from "../lib/uniformStock";
import { validDate } from "../lib/operationsPolicy";
import { requireStaffRole } from "../middlewares/requireStaffRole";

const router: IRouter = Router();
router.use(requireStaffRole("admin", "supervisor"));

function normalizedDate(value: unknown) {
  if (typeof value !== "string" || !validDate(value)) return value;
  return new Date(`${value}T00:00:00.000Z`);
}

function bodyWithDates(body: unknown, fields: string[], nestedExpenseDates = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const copy = { ...(body as Record<string, unknown>) };
  for (const field of fields) {
    if (field in copy && copy[field] !== null && copy[field] !== undefined) {
      copy[field] = normalizedDate(copy[field]);
    }
  }
  if (nestedExpenseDates && Array.isArray(copy.expenses)) {
    copy.expenses = copy.expenses.map((expense) => {
      if (!expense || typeof expense !== "object" || Array.isArray(expense)) {
        return expense;
      }
      const value = { ...(expense as Record<string, unknown>) };
      if ("expenseDate" in value) value.expenseDate = normalizedDate(value.expenseDate);
      return value;
    });
  }
  return copy;
}

function requiredIsoDate(value: unknown, label: string) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new DigitalOperationsError(400, "INVALID_DATE", `${label} is invalid.`);
  }
  return value.toISOString().slice(0, 10);
}

function optionalIsoDate(value: unknown, label: string): string | null {
  return value == null ? null : requiredIsoDate(value, label);
}

function badBody() {
  return new DigitalOperationsError(
    400,
    "INVALID_REQUEST_BODY",
    "The submitted information is incomplete or invalid.",
  );
}

async function actorId(req: Request) {
  const actor = await actorStaffFromRequest(req);
  if (!actor) {
    throw new DigitalOperationsError(401, "SESSION_REQUIRED", "Sign in again.");
  }
  return actor.id;
}

function action(
  handler: (req: Request, res: Response) => Promise<void>,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof DigitalOperationsError) {
        res.status(error.status).json({
          error: error.code,
          code: error.code,
          message: error.message,
        });
        return;
      }
      next(error);
    }
  };
}

function pettyInput(value: unknown, schema: typeof CreatePettyCashRecordBody | typeof UpdatePettyCashRecordBody) {
  const normalized = bodyWithDates(
    value,
    ["recordDate", "reimbursementSubmittedOn", "reimbursementPaidOn"],
    true,
  );
  const parsed = schema.safeParse(normalized);
  if (!parsed.success) throw badBody();
  const body = parsed.data as Record<string, unknown>;
  const input: PettyCashInput = {
    location: body.location as string,
    custodianId: body.custodianId as number,
    recordDate: requiredIsoDate(body.recordDate, "Record date"),
    openingFloatCents: body.openingFloatCents as number,
    cashOnHandCents: body.cashOnHandCents as number,
    status: body.status as PettyCashInput["status"],
    custodianAcknowledged: body.custodianAcknowledged as boolean,
    managerAcknowledged: body.managerAcknowledged as boolean,
    reimbursementStatus:
      body.reimbursementStatus as PettyCashInput["reimbursementStatus"],
    reimbursementAmountCents:
      body.reimbursementAmountCents as number | null | undefined,
    reimbursementReference:
      body.reimbursementReference as string | null | undefined,
    reimbursementSubmittedOn: optionalIsoDate(
      body.reimbursementSubmittedOn,
      "Reimbursement submission date",
    ),
    reimbursementPaidOn: optionalIsoDate(
      body.reimbursementPaidOn,
      "Reimbursement payment date",
    ),
    accountingNotes: body.accountingNotes as string | null | undefined,
    expenses: (
      body.expenses as Array<Record<string, unknown>>
    ).map((expense) => ({
      expenseDate: requiredIsoDate(expense.expenseDate, "Expense date"),
      description: expense.description as string,
      amountCents: expense.amountCents as number,
      receiptReceived: expense.receiptReceived as boolean,
    })),
  };
  return {
    input,
    expectedVersion:
      typeof body.expectedVersion === "number" ? body.expectedVersion : undefined,
  };
}

router.get("/petty-cash", action(async (_req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await pettyCashService.list());
}));

router.post("/petty-cash", action(async (req, res) => {
  const actor = await actorId(req);
  const { input } = pettyInput(req.body, CreatePettyCashRecordBody);
  res.status(201).json(await pettyCashService.create(input, actor));
}));

router.patch("/petty-cash/:recordId", action(async (req, res) => {
  const actor = await actorId(req);
  const recordId = requirePositiveId(req.params.recordId, "Record ID");
  const { input, expectedVersion } = pettyInput(req.body, UpdatePettyCashRecordBody);
  if (expectedVersion == null) throw badBody();
  res.json(await pettyCashService.update(recordId, expectedVersion, input, actor));
}));

router.get("/petty-cash/:recordId/history", action(async (req, res) => {
  const recordId = requirePositiveId(req.params.recordId, "Record ID");
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await pettyCashService.history(recordId));
}));

router.get("/petty-cash/:recordId/export.csv", action(async (req, res) => {
  const recordId = requirePositiveId(req.params.recordId, "Record ID");
  const csv = await pettyCashService.exportCsv(recordId);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="petty-cash-${recordId}.csv"`);
  res.status(200).send(csv);
}));

router.get("/uniform-stock", action(async (_req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await uniformStockService.listItems());
}));

router.post("/uniform-stock/items", action(async (req, res) => {
  const actor = await actorId(req);
  const normalized = bodyWithDates(req.body, ["lastOrderDate"]);
  const parsed = CreateUniformStockItemBody.safeParse(normalized);
  if (!parsed.success) throw badBody();
  const body = parsed.data as Record<string, unknown>;
  const input = {
    ...body,
    lastOrderDate: optionalIsoDate(body.lastOrderDate, "Last order date"),
  } as Parameters<typeof uniformStockService.createItem>[0];
  res.status(201).json(await uniformStockService.createItem(input, actor));
}));

router.patch("/uniform-stock/items/:itemId", action(async (req, res) => {
  const actor = await actorId(req);
  const itemId = requirePositiveId(req.params.itemId, "Item ID");
  const normalized = bodyWithDates(req.body, ["lastOrderDate"]);
  const parsed = UpdateUniformStockItemBody.safeParse(normalized);
  if (!parsed.success) throw badBody();
  const body = parsed.data as Record<string, unknown>;
  const input = {
    ...body,
    lastOrderDate: optionalIsoDate(body.lastOrderDate, "Last order date"),
  } as Parameters<typeof uniformStockService.updateItem>[1];
  res.json(await uniformStockService.updateItem(itemId, input, actor));
}));

router.get("/uniform-stock/transactions", action(async (_req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await uniformStockService.transactions());
}));

router.post("/uniform-stock/transactions", action(async (req, res) => {
  const actor = await actorId(req);
  const parsed = CreateUniformStockTransactionBody.safeParse(req.body);
  if (!parsed.success) throw badBody();
  res.status(201).json(
    await uniformStockService.createTransaction(
      parsed.data as Parameters<typeof uniformStockService.createTransaction>[0],
      actor,
    ),
  );
}));

router.get("/uniform-stock/export.csv", action(async (req, res) => {
  const view = req.query.view;
  if (view !== "stock" && view !== "history") {
    throw new DigitalOperationsError(
      400,
      "INVALID_EXPORT_VIEW",
      "Choose a stock or history export.",
    );
  }
  const csv = await uniformStockService.exportCsv(view);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="uniform-stock-${view}.csv"`);
  res.status(200).send(csv);
}));

export default router;
