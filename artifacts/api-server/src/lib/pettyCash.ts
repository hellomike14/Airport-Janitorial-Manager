import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  pettyCashExpensesTable,
  pettyCashRecordHistoryTable,
  pettyCashRecordsTable,
  staffTable,
} from "@workspace/db/schema";
import { csvCell } from "./operationsPolicy";
import { DigitalOperationsError } from "./digitalOperationsErrors";

export type PettyCashExpenseInput = {
  expenseDate: string;
  description: string;
  amountCents: number;
  receiptReceived: boolean;
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
    (!input.reimbursementPaidOn || input.reimbursementAmountCents == null)
  ) {
    throw new DigitalOperationsError(
      400,
      "REIMBURSEMENT_PAYMENT_DETAILS_REQUIRED",
      "Enter the reimbursement amount and payment date.",
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
  };
}

function makeSnapshot(input: PettyCashInput, calculations: ReturnType<typeof validatePettyCash>) {
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
    reimbursementAmountCents: input.reimbursementAmountCents ?? null,
    reimbursementReference: normalizeOptionalText(input.reimbursementReference),
    reimbursementSubmittedOn: input.reimbursementSubmittedOn ?? null,
    reimbursementPaidOn: input.reimbursementPaidOn ?? null,
    accountingNotes: normalizeOptionalText(input.accountingNotes),
    expenses: input.expenses.map((expense) => ({ ...expense })),
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

    async create(input: PettyCashInput, actorId: number) {
      const calculations = validatePettyCash(input);
      const id = await database.transaction(async (tx) => {
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
            status: input.status,
            custodianAcknowledgedAt: input.custodianAcknowledged ? now : null,
            custodianAcknowledgedRecordedById:
              input.custodianAcknowledged ? actorId : null,
            managerAcknowledgedById:
              input.status === "completed" ? actorId : null,
            managerAcknowledgedAt:
              input.status === "completed" ? now : null,
            reimbursementStatus: input.reimbursementStatus,
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
        if (input.expenses.length) {
          await tx.insert(pettyCashExpensesTable).values(
            input.expenses.map((expense) => ({
              recordId: record.id,
              recordVersion: 1,
              expenseDate: expense.expenseDate,
              description: expense.description.trim(),
              amountCents: expense.amountCents,
              receiptReceived: expense.receiptReceived,
            })),
          );
        }
        await tx.insert(pettyCashRecordHistoryTable).values({
          recordId: record.id,
          actorId,
          event: input.status === "completed" ? "completed" : "created",
          version: 1,
          snapshot: makeSnapshot(input, calculations),
          createdAt: now,
        });
        return record.id;
      });
      return (await listRecords()).find((record) => record.id === id)!;
    },

    async update(
      recordId: number,
      expectedVersion: number,
      input: PettyCashInput,
      actorId: number,
    ) {
      const calculations = validatePettyCash(input);
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
            status: input.status,
            custodianAcknowledgedAt: input.custodianAcknowledged ? now : null,
            custodianAcknowledgedRecordedById:
              input.custodianAcknowledged ? actorId : null,
            managerAcknowledgedById:
              input.status === "completed" ? actorId : null,
            managerAcknowledgedAt:
              input.status === "completed" ? now : null,
            reimbursementStatus: input.reimbursementStatus,
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
        if (input.expenses.length) {
          await tx.insert(pettyCashExpensesTable).values(
            input.expenses.map((expense) => ({
              recordId,
              recordVersion: version,
              expenseDate: expense.expenseDate,
              description: expense.description.trim(),
              amountCents: expense.amountCents,
              receiptReceived: expense.receiptReceived,
            })),
          );
        }
        await tx.insert(pettyCashRecordHistoryTable).values({
          recordId,
          actorId,
          event: input.status === "completed" ? "completed" : "updated",
          version,
          snapshot: makeSnapshot(input, calculations),
          createdAt: now,
        });
      });
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
        ["Custodian acknowledged", record.custodianAcknowledgedAt?.toISOString() ?? ""],
        ["Manager approved by", record.managerAcknowledgedByName ?? ""],
        ["Manager approved at", record.managerAcknowledgedAt?.toISOString() ?? ""],
        [],
        ["Expense date", "Description", "Amount", "Receipt received"],
        ...record.expenses.map((expense) => [
          expense.expenseDate,
          expense.description,
          (expense.amountCents / 100).toFixed(2),
          expense.receiptReceived ? "Yes" : "No",
        ]),
        [],
        ["Reimbursement status", record.reimbursementStatus],
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
