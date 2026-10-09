import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

export type PettyCashExpenseSnapshot = {
  expenseDate: string;
  description: string;
  amountCents: number;
  receiptReceived: boolean;
};

export const pettyCashRecordsTable = pgTable(
  "petty_cash_records",
  {
    id: serial("id").primaryKey(),
    location: text("location").notNull(),
    custodianId: integer("custodian_id")
      .notNull()
      .references(() => staffTable.id),
    recordDate: date("record_date", { mode: "string" }).notNull(),
    openingFloatCents: integer("opening_float_cents").notNull(),
    openingFloatApprovedById: integer("opening_float_approved_by_id")
      .notNull()
      .references(() => staffTable.id),
    openingFloatApprovedAt: timestamp("opening_float_approved_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    cashOnHandCents: integer("cash_on_hand_cents").notNull(),
    minimumReserveCents: integer("minimum_reserve_cents"),
    targetFloatCents: integer("target_float_cents"),
    status: text("status").notNull().default("draft"),
    custodianAcknowledgedAt: timestamp("custodian_acknowledged_at", {
      withTimezone: true,
    }),
    custodianAcknowledgedRecordedById: integer(
      "custodian_acknowledged_recorded_by_id",
    ).references(() => staffTable.id),
    managerAcknowledgedById: integer("manager_acknowledged_by_id").references(
      () => staffTable.id,
    ),
    managerAcknowledgedAt: timestamp("manager_acknowledged_at", {
      withTimezone: true,
    }),
    reimbursementStatus: text("reimbursement_status")
      .notNull()
      .default("not_submitted"),
    reimbursementPaidConfirmed: boolean("reimbursement_paid_confirmed"),
    reimbursementAmountCents: integer("reimbursement_amount_cents"),
    reimbursementReference: text("reimbursement_reference"),
    reimbursementSubmittedOn: date("reimbursement_submitted_on", {
      mode: "string",
    }),
    reimbursementPaidOn: date("reimbursement_paid_on", { mode: "string" }),
    accountingNotes: text("accounting_notes"),
    version: integer("version").notNull().default(1),
    createdById: integer("created_by_id")
      .notNull()
      .references(() => staffTable.id),
    updatedById: integer("updated_by_id")
      .notNull()
      .references(() => staffTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "petty_cash_opening_float_nonnegative",
      sql`${table.openingFloatCents} >= 0`,
    ),
    check(
      "petty_cash_actual_cash_nonnegative",
      sql`${table.cashOnHandCents} >= 0`,
    ),
    check(
      "petty_cash_reimbursement_amount_nonnegative",
      sql`${table.reimbursementAmountCents} IS NULL OR ${table.reimbursementAmountCents} >= 0`,
    ),
    check(
      "petty_cash_status_valid",
      sql`${table.status} IN ('draft', 'completed')`,
    ),
    check(
      "petty_cash_reimbursement_status_valid",
      sql`${table.reimbursementStatus} IN ('not_submitted', 'submitted', 'paid')`,
    ),
    check("petty_cash_version_positive", sql`${table.version} >= 1`),
    check(
      "petty_cash_completed_acknowledgements",
      sql`${table.status} <> 'completed' OR (
        ${table.custodianAcknowledgedAt} IS NOT NULL
        AND ${table.managerAcknowledgedById} IS NOT NULL
        AND ${table.managerAcknowledgedAt} IS NOT NULL
      )`,
    ),
    index("petty_cash_records_date_idx").on(table.recordDate, table.id),
    index("petty_cash_records_custodian_idx").on(table.custodianId),
  ],
);

export const pettyCashReceiptUploadsTable = pgTable(
  "petty_cash_receipt_uploads",
  {
    id: uuid("id").primaryKey(),
    actorId: integer("actor_id").notNull().references(() => staffTable.id),
    sessionHash: text("session_hash").notNull(),
    objectPath: text("object_path").notNull().unique(),
    stagingPath: text("staging_path").notNull().unique(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    status: text("status").notNull().default("reserved"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("petty_cash_receipt_upload_size_positive", sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 8388608`),
    check("petty_cash_receipt_upload_status_valid", sql`${table.status} IN ('reserved', 'uploaded', 'attached')`),
    index("petty_cash_receipt_upload_actor_idx").on(table.actorId, table.createdAt),
  ],
);

export const pettyCashReceiptAttachmentsTable = pgTable(
  "petty_cash_receipt_attachments",
  {
    id: uuid("id").primaryKey().references(() => pettyCashReceiptUploadsTable.id),
    recordId: integer("record_id").notNull().references(() => pettyCashRecordsTable.id),
    createdById: integer("created_by_id").notNull().references(() => staffTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("petty_cash_receipt_attachment_record_id_unique").on(table.recordId, table.id),
    index("petty_cash_receipt_attachment_record_idx").on(table.recordId, table.createdAt),
  ],
);

export const pettyCashExpensesTable = pgTable(
  "petty_cash_expenses",
  {
    id: serial("id").primaryKey(),
    recordId: integer("record_id")
      .notNull()
      .references(() => pettyCashRecordsTable.id),
    recordVersion: integer("record_version").notNull(),
    expenseDate: date("expense_date", { mode: "string" }).notNull(),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    receiptReceived: boolean("receipt_received").notNull().default(false),
    voucherNumber: text("voucher_number"),
    receiptAttachmentId: uuid("receipt_attachment_id")
      .references(() => pettyCashReceiptAttachmentsTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("petty_cash_expense_amount_positive", sql`${table.amountCents} > 0`),
    check("petty_cash_expense_version_positive", sql`${table.recordVersion} >= 1`),
    index("petty_cash_expenses_record_idx").on(
      table.recordId,
      table.recordVersion,
      table.id,
    ),
  ],
);

export const pettyCashRecordHistoryTable = pgTable(
  "petty_cash_record_history",
  {
    id: serial("id").primaryKey(),
    recordId: integer("record_id")
      .notNull()
      .references(() => pettyCashRecordsTable.id),
    actorId: integer("actor_id")
      .notNull()
      .references(() => staffTable.id),
    event: text("event").notNull(),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "petty_cash_history_event_valid",
      sql`${table.event} IN ('created', 'updated', 'completed')`,
    ),
    index("petty_cash_history_record_idx").on(
      table.recordId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const uniformStockItemsTable = pgTable(
  "uniform_stock_items",
  {
    id: serial("id").primaryKey(),
    itemCode: text("item_code"),
    itemName: text("item_name").notNull(),
    description: text("description"),
    size: text("size").notNull(),
    currentQuantity: integer("current_quantity").notNull(),
    reorderLevel: integer("reorder_level").notNull().default(6),
    lastOrderDate: date("last_order_date", { mode: "string" }),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdById: integer("created_by_id")
      .notNull()
      .references(() => staffTable.id),
    updatedById: integer("updated_by_id")
      .notNull()
      .references(() => staffTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "uniform_stock_quantity_nonnegative",
      sql`${table.currentQuantity} >= 0`,
    ),
    check(
      "uniform_stock_reorder_nonnegative",
      sql`${table.reorderLevel} >= 0`,
    ),
    check("uniform_stock_version_positive", sql`${table.version} >= 1`),
    uniqueIndex("uniform_stock_items_name_size_active_unique")
      .on(sql`lower(${table.itemName})`, sql`lower(${table.size})`)
      .where(sql`${table.active} = true`),
    index("uniform_stock_items_active_name_idx").on(
      table.active,
      table.itemName,
      table.size,
    ),
  ],
);

export const uniformStockTransactionsTable = pgTable(
  "uniform_stock_transactions",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => uniformStockItemsTable.id),
    staffId: integer("staff_id").references(() => staffTable.id),
    actorId: integer("actor_id")
      .notNull()
      .references(() => staffTable.id),
    type: text("type").notNull(),
    quantity: integer("quantity").notNull(),
    stockDelta: integer("stock_delta").notNull(),
    relatedIssueId: integer("related_issue_id").references(
      (): AnyPgColumn => uniformStockTransactionsTable.id,
    ),
    conditionReturned: text("condition_returned"),
    replacementIssued: boolean("replacement_issued")
      .notNull()
      .default(false),
    reason: text("reason").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "uniform_stock_transaction_type_valid",
      sql`${table.type} IN ('opening_balance', 'receipt', 'issue', 'return', 'adjustment')`,
    ),
    check(
      "uniform_stock_transaction_quantity_nonnegative",
      sql`${table.quantity} >= 0`,
    ),
    check(
      "uniform_stock_transaction_condition_valid",
      sql`${table.conditionReturned} IS NULL OR ${table.conditionReturned} IN ('serviceable', 'damaged')`,
    ),
    check(
      "uniform_stock_transaction_reference_shape",
      sql`(
        (${table.type} = 'return' AND ${table.relatedIssueId} IS NOT NULL AND ${table.staffId} IS NOT NULL)
        OR (${table.type} <> 'return' AND ${table.relatedIssueId} IS NULL)
      )`,
    ),
    index("uniform_stock_transactions_item_idx").on(
      table.itemId,
      table.occurredAt,
      table.id,
    ),
    index("uniform_stock_transactions_staff_idx").on(
      table.staffId,
      table.occurredAt,
    ),
    index("uniform_stock_transactions_issue_idx").on(table.relatedIssueId),
  ],
);
