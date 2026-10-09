import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import * as schema from "../../lib/db/src/schema/index.ts";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/unused";
process.env.NODE_ENV = "development";
const requireDb = createRequire(
  new URL("../../lib/db/package.json", import.meta.url),
);
const { drizzle } = requireDb("drizzle-orm/pglite");
const { eq } = requireDb("drizzle-orm");
const { PGlite } = requireDb("@electric-sql/pglite");
const {
  pettyCashExpensesTable,
  pettyCashRecordsTable,
  uniformStockItemsTable,
  uniformStockTransactionsTable,
} = schema;
const { createPettyCashService } = await import(
  "../../artifacts/api-server/src/lib/pettyCash.ts"
);
const { createUniformStockService } = await import(
  "../../artifacts/api-server/src/lib/uniformStock.ts"
);
const { DigitalOperationsError } = await import(
  "../../artifacts/api-server/src/lib/digitalOperationsErrors.ts"
);
const { assertOperationsManager, ConfidentialError } = await import(
  "../../artifacts/api-server/src/lib/confidentialAccess.ts"
);

let pg: any;
let database: any;
let pettyCash: ReturnType<typeof createPettyCashService>;
let uniformStock: ReturnType<typeof createUniformStockService>;

before(async () => {
  pg = await PGlite.create();
  await pg.exec(`
    CREATE TABLE staff (
      id integer PRIMARY KEY,
      name text NOT NULL,
      role text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      former_employee boolean NOT NULL DEFAULT false
    )
  `);
  const migration = readFileSync(
    new URL("../../lib/db/migrations/20261009_digital_operations.sql", import.meta.url),
    "utf8",
  );
  await pg.exec(migration);
  database = drizzle(pg, { schema });
  await pg.exec(`
    INSERT INTO staff (id, name, role, active, former_employee) VALUES
      (1, 'Test Manager', 'admin', true, false),
      (2, 'Current Employee', 'staff', true, false),
      (3, 'Former Employee', 'staff', false, true),
      (4, 'Test Inspector', 'inspector', true, false)
  `);
  pettyCash = createPettyCashService(database);
  uniformStock = createUniformStockService(database);
});

after(async () => {
  if (pg) await pg.close();
});

test("Petty Cash uses explicit floats, versioned expenses, acknowledgements and safe exports", async () => {
  const draft = {
    location: "Terminal A",
    custodianId: 2,
    recordDate: "2026-10-09",
    openingFloatCents: 10_000,
    cashOnHandCents: 8_500,
    status: "draft" as const,
    custodianAcknowledged: false,
    managerAcknowledged: false,
    reimbursementStatus: "not_submitted" as const,
    expenses: [
      {
        expenseDate: "2026-10-09",
        description: '=HYPERLINK("https://bad.example","click")',
        amountCents: 2_000,
        receiptReceived: false,
      },
    ],
  };
  const created = await pettyCash.create(draft, 1);
  assert.equal(created.openingFloatCents, 10_000);
  assert.equal(created.totalExpensesCents, 2_000);
  assert.equal(created.expectedBalanceCents, 8_000);
  assert.equal(created.overShortCents, 500);
  assert.equal(created.status, "draft");
  assert.equal(created.expenses[0]?.receiptReceived, false);

  await assert.rejects(
    pettyCash.exportCsv(created.id),
    (error: unknown) =>
      error instanceof DigitalOperationsError &&
      error.code === "PETTY_CASH_NOT_COMPLETED",
  );

  const completed = await pettyCash.update(
    created.id,
    1,
    {
      ...draft,
      status: "completed",
      custodianAcknowledged: true,
      managerAcknowledged: true,
    },
    1,
  );
  assert.equal(completed.version, 2);
  assert.ok(completed.custodianAcknowledgedAt);
  assert.ok(completed.managerAcknowledgedAt);
  const history = await pettyCash.history(created.id);
  assert.deepEqual(history.map((entry) => entry.event), ["completed", "created"]);

  const savedExpenseVersions = await database
    .select()
    .from(pettyCashExpensesTable)
    .where(eq(pettyCashExpensesTable.recordId, created.id));
  assert.deepEqual(savedExpenseVersions.map((row: { recordVersion: number }) => row.recordVersion), [1, 2]);

  const csv = await pettyCash.exportCsv(created.id);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /Receipt received/);
  await assert.rejects(
    pettyCash.update(created.id, 1, draft, 1),
    (error: unknown) =>
      error instanceof DigitalOperationsError &&
      error.code === "PETTY_CASH_VERSION_CONFLICT",
  );
});

test("Petty Cash preserves actual cash, reserve thresholds, record-date months and confirmed paid reimbursements", async () => {
  const base = {
    location: "Terminal B",
    custodianId: 2,
    openingFloatCents: 10_000,
    status: "draft" as const,
    custodianAcknowledged: false,
    managerAcknowledged: false,
    reimbursementStatus: "not_submitted" as const,
    expenses: [],
  };
  const below = await pettyCash.create({
    ...base,
    recordDate: "2026-08-29",
    cashOnHandCents: 2_999,
  }, 1);
  const exact = await pettyCash.create({
    ...base,
    recordDate: "2026-08-30",
    cashOnHandCents: 3_000,
  }, 1);
  const aboveTarget = await pettyCash.create({
    ...base,
    recordDate: "2026-08-31",
    cashOnHandCents: 12_000,
  }, 1);

  assert.equal(below.cashOnHandCents, 2_999);
  assert.equal(below.reserveStatus, "replenishment_required");
  assert.equal(below.suggestedTopUpCents, 7_001);
  assert.equal(exact.reserveStatus, "minimum_reached");
  assert.equal(exact.suggestedTopUpCents, 7_000);
  assert.equal(aboveTarget.suggestedTopUpCents, 0);

  await database.update(pettyCashRecordsTable)
    .set({ minimumReserveCents: null, targetFloatCents: null })
    .where(eq(pettyCashRecordsTable.id, below.id));
  const historical = (await pettyCash.list()).find((record) => record.id === below.id);
  assert.equal(historical?.minimumReserveCents, null);
  assert.equal(historical?.reserveStatus, null);
  assert.equal(historical?.suggestedTopUpCents, null);

  const paid = {
    ...base,
    location: "Terminal C",
    recordDate: "2026-09-30",
    cashOnHandCents: 3_000,
    status: "completed" as const,
    custodianAcknowledged: true,
    managerAcknowledged: true,
    reimbursementStatus: "paid" as const,
    reimbursementPaidConfirmed: true,
    reimbursementAmountCents: 450,
    reimbursementReference: "BANK-REF-2026-09",
    reimbursementSubmittedOn: "2026-09-30",
    reimbursementPaidOn: "2026-10-02",
    expenses: [{
      expenseDate: "2026-10-01",
      description: "Cleaning supplies",
      amountCents: 225,
      receiptReceived: true,
    }],
  };
  await assert.rejects(
    pettyCash.create({ ...paid, reimbursementPaidConfirmed: false }, 1),
    (error: unknown) =>
      error instanceof DigitalOperationsError &&
      error.code === "REIMBURSEMENT_PAYMENT_DETAILS_REQUIRED",
  );
  const paidRecord = await pettyCash.create(paid, 1);
  const september = await pettyCash.monthlyReport("2026-09");
  assert.equal(september.recordCount, 1);
  assert.equal(september.expenseTotalCents, 225);
  assert.equal(september.confirmedPaidReimbursementsCents, 450);
  assert.equal(september.latestRecordDate, "2026-09-30");
  await assert.rejects(
    pettyCash.create({ ...paid, location: "Terminal D" }, 1),
    (error: unknown) =>
      error instanceof DigitalOperationsError &&
      error.code === "REIMBURSEMENT_REFERENCE_USED",
  );
  assert.equal(
    (await pettyCash.monthlyReport("2026-09")).confirmedPaidReimbursementsCents,
    450,
  );
  assert.equal(paidRecord.reimbursementPaidConfirmed, true);
  await assert.rejects(
    pettyCash.update(
      paidRecord.id,
      paidRecord.version,
      { ...paid, reimbursementReference: "CHANGED-REFERENCE" },
      1,
    ),
    (error: unknown) =>
      error instanceof DigitalOperationsError &&
      error.code === "PAID_REIMBURSEMENT_IMMUTABLE",
  );
});

test("Uniform issues check current eligibility; historical returns work for former staff", async () => {
  const item = await uniformStock.createItem(
    {
      itemName: "Polo shirt",
      size: "M",
      openingQuantity: 2,
      openingReason: "Opening count verified by manager",
      reorderLevel: 1,
    },
    1,
  );
  assert.equal(item.currentQuantity, 2);

  const issue = await uniformStock.createTransaction(
    {
      type: "issue",
      itemId: item.id,
      staffId: 2,
      quantity: 1,
      reason: "Initial uniform issue",
    },
    1,
  );
  assert.equal(issue.remainingReturnQuantity, 1);

  await assert.rejects(
    uniformStock.createTransaction(
      {
        type: "issue",
        itemId: item.id,
        staffId: 3,
        quantity: 1,
        reason: "Former staff must be blocked",
      },
      1,
    ),
    (error: unknown) =>
      error instanceof DigitalOperationsError &&
      error.code === "STAFF_NOT_ELIGIBLE",
  );
  await assert.rejects(
    uniformStock.createTransaction(
      {
        type: "issue",
        itemId: item.id,
        staffId: 4,
        quantity: 1,
        reason: "Inspectors are not uniform recipients",
      },
      1,
    ),
    (error: unknown) =>
      error instanceof DigitalOperationsError &&
      error.code === "STAFF_NOT_ELIGIBLE",
  );
  await assert.rejects(
    uniformStock.createTransaction(
      {
        type: "issue",
        itemId: item.id,
        staffId: 2,
        quantity: 3,
        reason: "Must not make stock negative",
      },
      1,
    ),
    (error: unknown) =>
      error instanceof DigitalOperationsError &&
      error.code === "UNIFORM_STOCK_INSUFFICIENT",
  );

  await pg.exec(
    "UPDATE staff SET active = false, former_employee = true WHERE id = 2",
  );
  const archived = await uniformStock.updateItem(
    item.id,
    {
      expectedVersion: 2,
      itemName: "Polo shirt",
      size: "M",
      reorderLevel: 1,
      active: false,
    },
    1,
  );
  assert.equal(archived.active, false);

  const returned = await uniformStock.createTransaction(
    {
      type: "return",
      relatedIssueId: issue.id,
      quantity: 1,
      conditionReturned: "serviceable",
      replacementIssued: false,
      reason: "Returned on separation",
    },
    1,
  );
  assert.equal(returned.staffId, 2);
  assert.equal(returned.staffName, "Current Employee");
  assert.equal(returned.stockDelta, 1);
  assert.equal((await uniformStock.listItems())[0]?.currentQuantity, 2);
  assert.equal(
    (await uniformStock.transactions()).find((entry) => entry.id === issue.id)
      ?.remainingReturnQuantity,
    0,
  );
  await assert.rejects(
    uniformStock.createTransaction(
      {
        type: "return",
        relatedIssueId: issue.id,
        quantity: 1,
        conditionReturned: "serviceable",
        reason: "Cannot return beyond original issue",
      },
      1,
    ),
    (error: unknown) =>
      error instanceof DigitalOperationsError &&
      error.code === "RETURN_EXCEEDS_ISSUE",
  );
  const stockCsv = await uniformStock.exportCsv("stock");
  const historyCsv = await uniformStock.exportCsv("history");
  assert.match(stockCsv, /Outstanding with staff/);
  assert.match(historyCsv, /Returned on separation/);
});

test("Uniform Stock fixes reorder levels at six per item-size and audits the idempotent migration", async () => {
  const medium = await uniformStock.createItem(
    {
      itemName: "Jacket",
      size: "M",
      openingQuantity: 5,
      openingReason: "Verified opening count",
      reorderLevel: 0,
    },
    1,
  );
  const large = await uniformStock.createItem(
    {
      itemName: "Jacket",
      size: "L",
      openingQuantity: 7,
      openingReason: "Verified opening count",
      reorderLevel: 1,
    },
    1,
  );
  assert.equal(medium.reorderLevel, 6);
  assert.equal(medium.lowStock, true);
  assert.equal(large.reorderLevel, 6);
  assert.equal(large.lowStock, false);

  const transactionsBefore = await database.select()
    .from(uniformStockTransactionsTable)
    .where(eq(uniformStockTransactionsTable.itemId, medium.id));
  await database.update(uniformStockItemsTable)
    .set({ reorderLevel: 3 })
    .where(eq(uniformStockItemsTable.id, medium.id));
  await pg.exec(
    "DELETE FROM uniform_stock_migration_runs WHERE migration_key = 'uniform-reorder-level-six-v1'",
  );
  const migration = readFileSync(
    new URL("../../lib/db/migrations/20261009_digital_operations.sql", import.meta.url),
    "utf8",
  );
  await pg.exec(migration);
  const audit = await pg.query(
    "SELECT previous_reorder_level, new_reorder_level FROM uniform_stock_migration_audit WHERE item_id = $1",
    [medium.id],
  );
  assert.deepEqual(audit.rows, [{ previous_reorder_level: 3, new_reorder_level: 6 }]);
  const migrated = (await uniformStock.listItems()).find((item) => item.id === medium.id);
  assert.equal(migrated?.currentQuantity, 5);
  assert.equal(migrated?.reorderLevel, 6);
  const transactionsAfter = await database.select()
    .from(uniformStockTransactionsTable)
    .where(eq(uniformStockTransactionsTable.itemId, medium.id));
  assert.equal(transactionsAfter.length, transactionsBefore.length);

  await pg.exec(migration);
  const auditAfterSecondRun = await pg.query(
    "SELECT id FROM uniform_stock_migration_audit WHERE item_id = $1",
    [medium.id],
  );
  assert.equal(auditAfterSecondRun.rows.length, 1);
  const stockCsv = await uniformStock.exportCsv("stock");
  assert.match(stockCsv, /Reorder alert \(per item-size\)/);
  assert.match(stockCsv, /Reorder required/);
  assert.match(stockCsv, /No alert/);
});

test("protected Operations access accepts managers and rejects staff", () => {
  assert.doesNotThrow(() =>
    assertOperationsManager({ staffId: 1, sessionId: "test", role: "admin" }),
  );
  assert.doesNotThrow(() =>
    assertOperationsManager({ staffId: 18, sessionId: "test", role: "supervisor" }),
  );
  assert.throws(
    () => assertOperationsManager({ staffId: 2, sessionId: "test", role: "supervisor" }),
    (error: unknown) =>
      error instanceof ConfidentialError && error.code === "MANAGER_REQUIRED",
  );
  assert.throws(
    () => assertOperationsManager({ staffId: 7, sessionId: "test", role: "employee_administrator" }),
    (error: unknown) =>
      error instanceof ConfidentialError && error.code === "MANAGER_REQUIRED",
  );
  assert.throws(
    () => assertOperationsManager({ staffId: 3, sessionId: "test", role: "staff" }),
    (error: unknown) =>
      error instanceof ConfidentialError && error.code === "MANAGER_REQUIRED",
  );
  assert.throws(
    () => assertOperationsManager(null),
    (error: unknown) =>
      error instanceof ConfidentialError && error.status === 401,
  );
});
