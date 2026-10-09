import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import * as schema from "../../lib/db/src/schema/index.ts";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/unused";
const requireDb = createRequire(
  new URL("../../lib/db/package.json", import.meta.url),
);
const { drizzle } = requireDb("drizzle-orm/pglite");
const { eq } = requireDb("drizzle-orm");
const { PGlite } = requireDb("@electric-sql/pglite");
const { pettyCashExpensesTable } = schema;
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

test("protected Operations access accepts managers and rejects staff", () => {
  assert.doesNotThrow(() =>
    assertOperationsManager({ staffId: 1, sessionId: "test", role: "admin" }),
  );
  assert.doesNotThrow(() =>
    assertOperationsManager({ staffId: 2, sessionId: "test", role: "supervisor" }),
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
