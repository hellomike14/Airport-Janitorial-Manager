import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  pettyCashExpensesTable,
  pettyCashReceiptAttachmentsTable,
  pettyCashReceiptUploadsTable,
  pettyCashRecordHistoryTable,
  pettyCashRecordsTable,
  staffTable,
} from "@workspace/db/schema";
import { csvCell } from "./operationsPolicy";
import { DigitalOperationsError } from "./digitalOperationsErrors";
import { digest } from "./confidentialAccess";

export const PETTY_CASH_MINIMUM_RESERVE_CENTS = 3_000;
export const PETTY_CASH_TARGET_FLOAT_CENTS = 10_000;

export type PettyCashExpenseInput = {
  expenseDate: string;
  description: string;
  amountCents: number;
  receiptReceived: boolean;
  voucherNumber?: string | null;
  receiptAttachmentId?: string | null;
  receiptUploadId?: string | null;
};

export type PettyCashInput = {
  location: string;
  custodianId: number;
  recordDate: string;
  openingFloatCents: number;
  cashOnHandCents: number;
  status: "draft" | "completed";
  custodianAcknowledged: boolean;
  managerAcknowledged: boolean;
  reimbursementStatus: "not_submitted" | "submitted" | "paid";
  reimbursementPaidConfirmed?: boolean;
  reimbursementAmountCents?: number | null;
  reimbursementReference?: string | null;
  reimbursementSubmittedOn?: string | null;
  reimbursementPaidOn?: string | null;
  accountingNotes?: string | null;
  expenses: PettyCashExpenseInput[];
};

type DigitalDb = typeof db;
const normalizeOptionalText = (value: string | null | undefined) =>
  value?.trim() || null;
const isDuplicatePaidReference = (error: unknown) => {
  let current = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint === "petty_cash_paid_reference_unique") {
      return true;
    }
    current = candidate.cause;
  }
  return false;
};

function validatePettyCash(input: PettyCashInput) {
  if (input.status === "completed" &&
    (!input.custodianAcknowledged || !input.managerAcknowledged)) {
    throw new DigitalOperationsError(
      400,
      "ACKNOWLEDGEMENT_REQUIRED",
      "A completed reconciliation requires both acknowledgements.",
    );
  }
  if (input.status === "draft" && input.managerAcknowledged) {
    throw new DigitalOperationsError(
      400,
      "MANAGER_ACKNOWLEDGEMENT_INVALID",
      "Manager approval is recorded when the reconciliation is completed.",
    );
  }
  if (
    (input.reimbursementStatus === "submitted" ||
      input.reimbursementStatus === "paid") &&
    !input.reimbursementSubmittedOn
  ) {
    throw new DigitalOperationsError(
      400,
      "REIMBURSEMENT_DATE_REQUIRED",
      "Enter the reimbursement submission date.",
    );
  }
  if (
    input.reimbursementStatus === "paid" &&
    (!input.reimbursementPaidOn || input.reimbursementAmountCents == null ||
      input.reimbursementAmountCents <= 0 ||
      !normalizeOptionalText(input.reimbursementReference) ||
      input.reimbursementPaidConfirmed !== true)
  ) {
    throw new DigitalOperationsError(
      400,
      "REIMBURSEMENT_PAYMENT_DETAILS_REQUIRED",
      "Enter the confirmed payment amount, date and reference.",
    );
  }
  const total = input.expenses.reduce((sum, expense) => {
    const next = sum + expense.amountCents;
    if (!Number.isSafeInteger(next)) {
      throw new DigitalOperationsError(
        400,
        "AMOUNT_TOO_LARGE",
        "Expense totals exceed the supported amount.",
      );
    }
    return next;
  }, 0);
  return {
    totalExpensesCents: total,
    expectedBalanceCents: input.openingFloatCents - total,
    overShortCents:
      input.cashOnHandCents - (input.openingFloatCents - total),
    minimumReserveCents: PETTY_CASH_MINIMUM_RESERVE_CENTS,
    targetFloatCents: PETTY_CASH_TARGET_FLOAT_CENTS,
    reserveStatus: input.cashOnHandCents < PETTY_CASH_MINIMUM_RESERVE_CENTS
      ? "replenishment_required"
      : input.cashOnHandCents === PETTY_CASH_MINIMUM_RESERVE_CENTS
        ? "minimum_reached"
        : "above_minimum",
    suggestedTopUpCents: Math.max(
      0,
      PETTY_CASH_TARGET_FLOAT_CENTS - input.cashOnHandCents,
    ),
  };
}

type ExpenseConnection = Pick<typeof db, "select" | "insert" | "update">;
async function writeExpenses(
  conn: ExpenseConnection,
  recordId: number,
  recordVersion: number,
  inputs: PettyCashExpenseInput[],
  actorId: number,
  sessionHash: string,
) {
  const values = [];
  for (const expense of inputs) {
    if (expense.receiptAttachmentId && expense.receiptUploadId) {
      throw new DigitalOperationsError(400, "RECEIPT_SELECTION_INVALID", "Choose one receipt photo for each expense.");
    }
    let receiptAttachmentId: string | null = null;
    if (expense.receiptUploadId) {
      if (!sessionHash) {
        throw new DigitalOperationsError(401, "SESSION_REQUIRED", "Sign in again before saving receipt photos.");
      }
      const [upload] = await conn.select().from(pettyCashReceiptUploadsTable)
        .where(eq(pettyCashReceiptUploadsTable.id, expense.receiptUploadId))
        .for("update").limit(1);
      if (!upload || upload.actorId !== actorId ||
          upload.sessionHash !== sessionHash || upload.status !== "uploaded") {
        throw new DigitalOperationsError(403, "RECEIPT_UPLOAD_INVALID", "This receipt photo is no longer available. Upload it again.");
      }
      if (upload.expiresAt <= new Date()) {
        throw new DigitalOperationsError(410, "RECEIPT_UPLOAD_EXPIRED", "This receipt photo expired. Upload it again.");
      }
      receiptAttachmentId = upload.id;
      await conn.insert(pettyCashReceiptAttachmentsTable).values({
        id: upload.id,
        recordId,
        createdById: actorId,
      });
      await conn.update(pettyCashReceiptUploadsTable)
        .set({ status: "attached" })
        .where(eq(pettyCashReceiptUploadsTable.id, upload.id));
    } else if (expense.receiptAttachmentId) {
      const [attachment] = await conn.select({ id: pettyCashReceiptAttachmentsTable.id })
        .from(pettyCashReceiptAttachmentsTable)
        .where(and(
          eq(pettyCashReceiptAttachmentsTable.id, expense.receiptAttachmentId),
          eq(pettyCashReceiptAttachmentsTable.recordId, recordId),
        )).limit(1);
      if (!attachment) {
        throw new DigitalOperationsError(403, "RECEIPT_ATTACHMENT_INVALID", "A receipt photo must belong to this reconciliation.");
      }
      receiptAttachmentId = attachment.id;
    }
    values.push({
      recordId,
      recordVersion,
      expenseDate: expense.expenseDate,
      description: expense.description.trim(),
      amountCents: expense.amountCents,
      receiptReceived: expense.receiptReceived || receiptAttachmentId !== null,
      voucherNumber: normalizeOptionalText(expense.voucherNumber)?.slice(0, 100) ?? null,
      receiptAttachmentId,
    });
  }
  if (!values.length) return [];
  const rows = await conn.insert(pettyCashExpensesTable).values(values).returning();
  return rows.map((expense) => ({
    expenseDate: expense.expenseDate,
    description: expense.description,
    amountCents: expense.amountCents,
    receiptReceived: expense.receiptReceived,
    voucherNumber: expense.voucherNumber,
    receiptAttachmentId: expense.receiptAttachmentId,
  }));
}

function makeSnapshot(
  input: PettyCashInput,
  calculations: ReturnType<typeof validatePettyCash>,
  expenses: Awaited<ReturnType<typeof writeExpenses>>,
) {
  return {
    location: input.location,
    custodianId: input.custodianId,
    recordDate: input.recordDate,
    openingFloatCents: input.openingFloatCents,
    cashOnHandCents: input.cashOnHandCents,
    status: input.status,
    custodianAcknowledged: input.custodianAcknowledged,
    managerAcknowledged: input.managerAcknowledged,
    reimbursementStatus: input.reimbursementStatus,
    reimbursementPaidConfirmed: input.reimbursementPaidConfirmed === true,
    reimbursementAmountCents: input.reimbursementAmountCents ?? null,
    reimbursementReference: normalizeOptionalText(input.reimbursementReference),
    reimbursementSubmittedOn: input.reimbursementSubmittedOn ?? null,
    reimbursementPaidOn: input.reimbursementPaidOn ?? null,
    accountingNotes: normalizeOptionalText(input.accountingNotes),
    expenses,
    ...calculations,
  };
}

export function createPettyCashService(database: DigitalDb = db) {
  async function listRecords(conn: DigitalDb = database) {
    const rows = await conn
      .select()
      .from(pettyCashRecordsTable)
      .orderBy(desc(pettyCashRecordsTable.recordDate), desc(pettyCashRecordsTable.id));
    if (!rows.length) return [];

    const recordIds = rows.map((row) => row.id);
    const expenseRows = await conn
      .select()
      .from(pettyCashExpensesTable)
      .where(inArray(pettyCashExpensesTable.recordId, recordIds))
      .orderBy(pettyCashExpensesTable.id);
    const attachmentIds = [...new Set(expenseRows
      .map((expense) => expense.receiptAttachmentId)
      .filter((value): value is string => value != null))];
    const attachments = attachmentIds.length
      ? await conn.select({
          id: pettyCashReceiptAttachmentsTable.id,
          recordId: pettyCashReceiptAttachmentsTable.recordId,
          fileName: pettyCashReceiptUploadsTable.fileName,
          contentType: pettyCashReceiptUploadsTable.contentType,
          sizeBytes: pettyCashReceiptUploadsTable.sizeBytes,
        })
        .from(pettyCashReceiptAttachmentsTable)
        .innerJoin(pettyCashReceiptUploadsTable, eq(
          pettyCashReceiptAttachmentsTable.id,
          pettyCashReceiptUploadsTable.id,
        ))
        .where(inArray(pettyCashReceiptAttachmentsTable.id, attachmentIds))
      : [];
    const attachmentMap = new Map(attachments.map((attachment) => [
      attachment.id,
      attachment,
    ]));
    const staffIds = [...new Set(rows.flatMap((row) => [
      row.custodianId,
      row.openingFloatApprovedById,
      row.custodianAcknowledgedRecordedById,
      row.managerAcknowledgedById,
    ]).filter((id): id is number => id != null))];
    const people = staffIds.length
      ? await conn
          .select({ id: staffTable.id, name: staffTable.name })
          .from(staffTable)
          .where(inArray(staffTable.id, staffIds))
      : [];
    const names = new Map(people.map((person) => [person.id, person.name]));

    return rows.map((row) => {
      const expenses = expenseRows
        .filter((expense) =>
          expense.recordId === row.id &&
          expense.recordVersion === row.version,
        )
        .map((expense) => ({
          id: expense.id,
          expenseDate: expense.expenseDate,
          description: expense.description,
          amountCents: expense.amountCents,
          receiptReceived: expense.receiptReceived,
          voucherNumber: expense.voucherNumber,
          receiptAttachment: expense.receiptAttachmentId
            ? (() => {
                const attachment = attachmentMap.get(expense.receiptAttachmentId!);
                return attachment?.recordId === row.id
                  ? {
                      id: attachment.id,
                      fileName: attachment.fileName,
                      contentType: attachment.contentType,
                      sizeBytes: attachment.sizeBytes,
                    }
                  : null;
              })()
            : null,
        }));
      const totalExpensesCents = expenses.reduce(
        (sum, expense) => sum + expense.amountCents,
        0,
      );
      const expectedBalanceCents =
        row.openingFloatCents - totalExpensesCents;
      return {
        id: row.id,
        location: row.location,
        custodianId: row.custodianId,
        custodianName: names.get(row.custodianId) ?? "Unknown staff",
        recordDate: row.recordDate,
        openingFloatCents: row.openingFloatCents,
        openingFloatApprovedByName:
          names.get(row.openingFloatApprovedById) ?? "Unknown manager",
        openingFloatApprovedAt: row.openingFloatApprovedAt,
        cashOnHandCents: row.cashOnHandCents,
        expenses,
        totalExpensesCents,
        expectedBalanceCents,
        overShortCents: row.cashOnHandCents - expectedBalanceCents,
        minimumReserveCents: row.minimumReserveCents,
        targetFloatCents: row.targetFloatCents,
        reserveStatus: row.minimumReserveCents == null || row.targetFloatCents == null
          ? null
          : row.cashOnHandCents < row.minimumReserveCents
            ? "replenishment_required"
            : row.cashOnHandCents === row.minimumReserveCents
              ? "minimum_reached"
              : "above_minimum",
        suggestedTopUpCents: row.minimumReserveCents == null || row.targetFloatCents == null
          ? null
          : Math.max(0, row.targetFloatCents - row.cashOnHandCents),
        status: row.status,
        custodianAcknowledgedAt: row.custodianAcknowledgedAt,
        custodianAcknowledgedRecordedByName:
          row.custodianAcknowledgedRecordedById == null
            ? null
            : names.get(row.custodianAcknowledgedRecordedById) ?? "Unknown manager",
        managerAcknowledgedByName:
          row.managerAcknowledgedById == null
            ? null
            : names.get(row.managerAcknowledgedById) ?? "Unknown manager",
        managerAcknowledgedAt: row.managerAcknowledgedAt,
        reimbursementStatus: row.reimbursementStatus,
        reimbursementPaidConfirmed: row.reimbursementPaidConfirmed,
        reimbursementAmountCents: row.reimbursementAmountCents,
        reimbursementReference: row.reimbursementReference,
        reimbursementSubmittedOn: row.reimbursementSubmittedOn,
        reimbursementPaidOn: row.reimbursementPaidOn,
        accountingNotes: row.accountingNotes,
        version: row.version,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  async function recordExists(recordId: number, conn: DigitalDb = database) {
    const [row] = await conn
      .select({ id: pettyCashRecordsTable.id })
      .from(pettyCashRecordsTable)
      .where(eq(pettyCashRecordsTable.id, recordId))
      .limit(1);
    return !!row;
  }

  return {
    async list() {
      return listRecords();
    },

    async create(input: PettyCashInput, actorId: number, sessionHash = "") {
      const calculations = validatePettyCash(input);
      let id: number;
      try {
        id = await database.transaction(async (tx) => {
        const [custodian] = await tx
          .select({ id: staffTable.id })
          .from(staffTable)
          .where(eq(staffTable.id, input.custodianId))
          .limit(1);
        if (!custodian) {
          throw new DigitalOperationsError(
            400,
            "CUSTODIAN_NOT_FOUND",
            "Select an existing custodian.",
          );
        }
        const now = new Date();
        const [record] = await tx
          .insert(pettyCashRecordsTable)
          .values({
            location: input.location.trim(),
            custodianId: input.custodianId,
            recordDate: input.recordDate,
            openingFloatCents: input.openingFloatCents,
            openingFloatApprovedById: actorId,
            openingFloatApprovedAt: now,
            cashOnHandCents: input.cashOnHandCents,
            minimumReserveCents: PETTY_CASH_MINIMUM_RESERVE_CENTS,
            targetFloatCents: PETTY_CASH_TARGET_FLOAT_CENTS,
            status: input.status,
            custodianAcknowledgedAt: input.custodianAcknowledged ? now : null,
            custodianAcknowledgedRecordedById:
              input.custodianAcknowledged ? actorId : null,
            managerAcknowledgedById:
              input.status === "completed" ? actorId : null,
            managerAcknowledgedAt:
              input.status === "completed" ? now : null,
            reimbursementStatus: input.reimbursementStatus,
            reimbursementPaidConfirmed: input.reimbursementPaidConfirmed === true,
            reimbursementAmountCents:
              input.reimbursementAmountCents ?? null,
            reimbursementReference: normalizeOptionalText(
              input.reimbursementReference,
            ),
            reimbursementSubmittedOn:
              input.reimbursementSubmittedOn ?? null,
            reimbursementPaidOn: input.reimbursementPaidOn ?? null,
            accountingNotes: normalizeOptionalText(input.accountingNotes),
            version: 1,
            createdById: actorId,
            updatedById: actorId,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: pettyCashRecordsTable.id });
        const expenses = await writeExpenses(
          tx,
          record.id,
          1,
          input.expenses,
          actorId,
          sessionHash,
        );
        await tx.insert(pettyCashRecordHistoryTable).values({
          recordId: record.id,
          actorId,
          event: input.status === "completed" ? "completed" : "created",
          version: 1,
          snapshot: makeSnapshot(input, calculations, expenses),
          createdAt: now,
        });
        return record.id;
        });
      } catch (error) {
        if (isDuplicatePaidReference(error)) {
          throw new DigitalOperationsError(409, "REIMBURSEMENT_REFERENCE_USED", "That payment reference is already recorded as paid.");
        }
        throw error;
      }
      return (await listRecords()).find((record) => record.id === id)!;
    },

    async update(
      recordId: number,
      expectedVersion: number,
      input: PettyCashInput,
      actorId: number,
      sessionHash = "",
    ) {
      const calculations = validatePettyCash(input);
      try {
        await database.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(pettyCashRecordsTable)
          .where(eq(pettyCashRecordsTable.id, recordId))
          .for("update")
          .limit(1);
        if (!current) {
          throw new DigitalOperationsError(
            404,
            "PETTY_CASH_NOT_FOUND",
            "Petty Cash record not found.",
          );
        }
        if (current.version !== expectedVersion) {
          throw new DigitalOperationsError(
            409,
            "PETTY_CASH_VERSION_CONFLICT",
            "This record changed. Reload it before saving.",
          );
        }
        if (current.reimbursementStatus === "paid" && (
          input.reimbursementStatus !== "paid" ||
          input.reimbursementPaidConfirmed !== true ||
          input.reimbursementAmountCents !== current.reimbursementAmountCents ||
          input.reimbursementPaidOn !== current.reimbursementPaidOn ||
          normalizeOptionalText(input.reimbursementReference)?.toLowerCase() !==
            normalizeOptionalText(current.reimbursementReference)?.toLowerCase()
        )) {
          throw new DigitalOperationsError(409, "PAID_REIMBURSEMENT_IMMUTABLE", "A confirmed paid reimbursement cannot be changed or counted again.");
        }
        const [custodian] = await tx
          .select({ id: staffTable.id })
          .from(staffTable)
          .where(eq(staffTable.id, input.custodianId))
          .limit(1);
        if (!custodian) {
          throw new DigitalOperationsError(
            400,
            "CUSTODIAN_NOT_FOUND",
            "Select an existing custodian.",
          );
        }
        const now = new Date();
        const version = current.version + 1;
        await tx
          .update(pettyCashRecordsTable)
          .set({
            location: input.location.trim(),
            custodianId: input.custodianId,
            recordDate: input.recordDate,
            openingFloatCents: input.openingFloatCents,
            openingFloatApprovedById: actorId,
            openingFloatApprovedAt: now,
            cashOnHandCents: input.cashOnHandCents,
            minimumReserveCents: PETTY_CASH_MINIMUM_RESERVE_CENTS,
            targetFloatCents: PETTY_CASH_TARGET_FLOAT_CENTS,
            status: input.status,
            custodianAcknowledgedAt: input.custodianAcknowledged ? now : null,
            custodianAcknowledgedRecordedById:
              input.custodianAcknowledged ? actorId : null,
            managerAcknowledgedById:
              input.status === "completed" ? actorId : null,
            managerAcknowledgedAt:
              input.status === "completed" ? now : null,
            reimbursementStatus: input.reimbursementStatus,
            reimbursementPaidConfirmed: input.reimbursementPaidConfirmed === true,
            reimbursementAmountCents:
              input.reimbursementAmountCents ?? null,
            reimbursementReference: normalizeOptionalText(
              input.reimbursementReference,
            ),
            reimbursementSubmittedOn:
              input.reimbursementSubmittedOn ?? null,
            reimbursementPaidOn: input.reimbursementPaidOn ?? null,
            accountingNotes: normalizeOptionalText(input.accountingNotes),
            version,
            updatedById: actorId,
            updatedAt: now,
          })
          .where(and(
            eq(pettyCashRecordsTable.id, recordId),
            eq(pettyCashRecordsTable.version, expectedVersion),
          ));
        const expenses = await writeExpenses(
          tx,
          recordId,
          version,
          input.expenses,
          actorId,
          sessionHash,
        );
        await tx.insert(pettyCashRecordHistoryTable).values({
          recordId,
          actorId,
          event: input.status === "completed" ? "completed" : "updated",
          version,
          snapshot: makeSnapshot(input, calculations, expenses),
          createdAt: now,
        });
        });
      } catch (error) {
        if (isDuplicatePaidReference(error)) {
          throw new DigitalOperationsError(409, "REIMBURSEMENT_REFERENCE_USED", "That payment reference is already recorded as paid.");
        }
        throw error;
      }
      return (await listRecords()).find((record) => record.id === recordId)!;
    },

    async history(recordId: number) {
      if (!(await recordExists(recordId))) {
        throw new DigitalOperationsError(
          404,
          "PETTY_CASH_NOT_FOUND",
          "Petty Cash record not found.",
        );
      }
      const rows = await database
        .select()
        .from(pettyCashRecordHistoryTable)
        .where(eq(pettyCashRecordHistoryTable.recordId, recordId))
        .orderBy(desc(pettyCashRecordHistoryTable.createdAt), desc(pettyCashRecordHistoryTable.id));
      if (!rows.length) return [];
      const actorIds = [...new Set(rows.map((row) => row.actorId))];
      const people = await database
        .select({ id: staffTable.id, name: staffTable.name })
        .from(staffTable)
        .where(inArray(staffTable.id, actorIds));
      const names = new Map(people.map((person) => [person.id, person.name]));
      return rows.map((row) => ({
        id: row.id,
        event: row.event,
        version: row.version,
        actorName: names.get(row.actorId) ?? "Unknown manager",
        snapshot: row.snapshot,
        createdAt: row.createdAt,
      }));
    },

    async monthlyReport(month: string) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw new DigitalOperationsError(400, "INVALID_MONTH", "Use YYYY-MM.");
      }
      const records = (await listRecords()).filter((record) =>
        record.recordDate.startsWith(month),
      );
      const latest = records[0];
      return {
        month,
        recordCount: records.length,
        expenseTotalCents: records.reduce(
          (sum, record) => sum + record.totalExpensesCents,
          0,
        ),
        confirmedPaidReimbursementsCents: records.reduce(
          (sum, record) => sum + (record.reimbursementStatus === "paid" && record.reimbursementPaidConfirmed === true
            ? record.reimbursementAmountCents ?? 0
            : 0),
          0,
        ),
        latestRecordDate: latest?.recordDate ?? null,
        cashOnHandCents: latest?.cashOnHandCents ?? null,
        minimumReserveCents: latest?.minimumReserveCents ?? null,
        targetFloatCents: latest?.targetFloatCents ?? null,
        reserveStatus: latest?.reserveStatus ?? null,
        suggestedTopUpCents: latest?.suggestedTopUpCents ?? null,
      };
    },

    async exportCsv(recordId: number) {
      const record = (await listRecords()).find((row) => row.id === recordId);
      if (!record) {
        throw new DigitalOperationsError(
          404,
          "PETTY_CASH_NOT_FOUND",
          "Petty Cash record not found.",
        );
      }
      if (record.status !== "completed") {
        throw new DigitalOperationsError(
          409,
          "PETTY_CASH_NOT_COMPLETED",
          "Complete both acknowledgements before exporting this record.",
        );
      }
      const rows: unknown[][] = [
        ["Marvol Facility Services", "Petty Cash Reconciliation"],
        ["Record date", record.recordDate],
        ["Location", record.location],
        ["Custodian", record.custodianName],
        ["Opening float", (record.openingFloatCents / 100).toFixed(2)],
        ["Expenses", (record.totalExpensesCents / 100).toFixed(2)],
        ["Expected balance", (record.expectedBalanceCents / 100).toFixed(2)],
        ["Actual cash on hand", (record.cashOnHandCents / 100).toFixed(2)],
        ["Over / (short)", (record.overShortCents / 100).toFixed(2)],
        ["Minimum reserve", record.minimumReserveCents == null ? "" : (record.minimumReserveCents / 100).toFixed(2)],
        ["Reserve status", record.reserveStatus ?? "Not stored for this historical record"],
        ["Suggested top-up to target", record.suggestedTopUpCents == null ? "" : (record.suggestedTopUpCents / 100).toFixed(2)],
        ["Custodian acknowledged", record.custodianAcknowledgedAt?.toISOString() ?? ""],
        ["Manager approved by", record.managerAcknowledgedByName ?? ""],
        ["Manager approved at", record.managerAcknowledgedAt?.toISOString() ?? ""],
        [],
        ["Expense date", "Voucher number", "Description", "Amount", "Receipt received", "Receipt photo"],
        ...record.expenses.map((expense) => [
          expense.expenseDate,
          expense.voucherNumber ?? "",
          expense.description,
          (expense.amountCents / 100).toFixed(2),
          expense.receiptReceived ? "Yes" : "No",
          expense.receiptAttachment ? "Attached" : "",
        ]),
        [],
        ["Reimbursement status", record.reimbursementStatus],
        ["Paid payment confirmed", record.reimbursementPaidConfirmed === true ? "Yes" : "No"],
        ["Reimbursement amount", record.reimbursementAmountCents == null ? "" : (record.reimbursementAmountCents / 100).toFixed(2)],
        ["Reimbursement reference", record.reimbursementReference ?? ""],
        ["Submitted on", record.reimbursementSubmittedOn ?? ""],
        ["Paid on", record.reimbursementPaidOn ?? ""],
        ["Accounting notes", record.accountingNotes ?? ""],
      ];
      return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
    },
  };
}

export const pettyCashService = createPettyCashService();
