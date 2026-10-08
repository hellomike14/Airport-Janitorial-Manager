import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import { createRequire } from "node:module";
import * as schema from "../lib/db/src/schema/index.ts";

// Exercise the production messages router over HTTP with real Drizzle queries
// against an in-memory PostgreSQL database. Identity is supplied only by this
// isolated test harness; the production Clerk session path is not under test.
const requireDb = createRequire(new URL("../lib/db/package.json", import.meta.url));
const requireApi = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { drizzle } = requireDb("drizzle-orm/pglite");
const { is, SQL } = requireDb("drizzle-orm");
const { PgDialect, PgTable, getTableConfig } = requireDb("drizzle-orm/pg-core");
const { PGlite } = requireDb("@electric-sql/pglite");
const express = requireApi("express");
let pg: any;
let db: any;
let messagesRouter: any;
let inboundSendgridRouter: any;

const people = [
  { id: 1, name: "Test Admin One", role: "admin", email: null },
  { id: 2, name: "Test Supervisor", role: "supervisor", email: null },
  { id: 3, name: "Test Staff", role: "staff", email: null },
  { id: 10, name: "Test Inspector", role: "inspector", email: "inspector@marvolenterprises.com" },
  { id: 11, name: "Test Admin Two", role: "admin", email: null },
].map((person) => ({
  ...person,
  phone: null,
  active: true,
  loginEnabled: true,
  formerEmployee: false,
}));

let server: any;
let origin: string;
const ids = [101, 102, 103];
const acceptedAtOne = "2026-09-01T13:00:00.000Z";
const acceptedAtTwo = "2026-09-02T13:00:00.000Z";
const receivedAt = "2026-09-03T13:00:00.000Z";

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
async function createFixtureTables() {
  const dialect = new PgDialect();
  const neededTables = new Set([
    "staff",
    "conversations",
    "messages",
    "message_email_outbox",
    "message_receipt_acknowledgements",
    "conversation_participants",
    "conversation_archives",
    "inbound_email_messages",
    "inspector_task_links",
    "notifications",
    "areas",
    "tasks",
  ]);
  for (const table of Object.values(schema)) {
    if (!is(table, PgTable)) continue;
    const config = getTableConfig(table);
    if (!neededTables.has(config.name)) continue;
    const definitions = config.columns.map((column: any) => {
      let definition = `${quote(column.name)} ${column.getSQLType()}${column.notNull ? " NOT NULL" : ""}${column.primary ? " PRIMARY KEY" : ""}`;
      if (column.default !== undefined) {
        definition += ` DEFAULT ${is(column.default, SQL)
          ? dialect.sqlToQuery(column.default).sql
          : typeof column.default === "string"
            ? `'${column.default.replaceAll("'", "''")}'`
            : JSON.stringify(column.default)}`;
      }
      return definition;
    });
    await pg.exec(`CREATE TABLE ${quote(config.name)} (${definitions.join(", ")})`);
  }
  // These indexes support the real upsert/conflict paths exercised below.
  await pg.exec("CREATE UNIQUE INDEX conversation_participants_unique ON conversation_participants (conversation_id, staff_id)");
  await pg.exec("CREATE UNIQUE INDEX conversation_archives_unique ON conversation_archives (conversation_id, staff_id)");
  await pg.exec("CREATE UNIQUE INDEX message_receipt_acknowledgements_message_version_unique ON message_receipt_acknowledgements (message_id, message_version)");
}

async function seedFixtures() {
  for (const person of people) {
    await pg.query(
      `INSERT INTO staff (id,name,role,email,phone,active,login_enabled,former_employee)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [person.id, person.name, person.role, person.email, person.phone, person.active, person.loginEnabled, person.formerEmployee],
    );
  }

  await pg.query(
    `INSERT INTO conversations (id,participant_a_id,participant_b_id,is_group,created_at) VALUES
      (101,1,10,false,'2026-09-01T10:00:00Z'),
      (102,2,10,false,'2026-09-02T10:00:00Z'),
      (103,10,11,false,'2026-09-03T10:00:00Z'),
      (104,1,3,false,'2026-09-04T10:00:00Z')`,
  );
  await pg.query(
    `INSERT INTO messages (id,conversation_id,sender_id,body,created_at) VALUES
      (201,101,1,'fixture outbound one','2026-09-01T12:00:00Z'),
      (202,102,2,'fixture outbound two','2026-09-02T12:00:00Z'),
      (203,103,10,'fixture inbound reply','2026-09-03T12:00:00Z'),
      (204,104,1,'unrelated fixture DM','2026-09-04T12:00:00Z')`,
  );
  await pg.query(
    `INSERT INTO message_email_outbox
      (id,message_id,conversation_id,inspector_id,supervisor_id,inspector_email,inspector_name,supervisor_name,message_body,status,accepted_at)
     VALUES
      (1,201,101,10,1,'fixture-recipient@example.test','Test Inspector','Test Admin One','fixture outbound one','accepted',$1),
       (2,202,102,10,2,'fixture-recipient@example.test','Test Inspector','Test Supervisor','fixture outbound two','accepted',$2),
       (3,201,101,10,1,'fixture-recipient-two@example.test','Test Inspector','Test Admin One','fixture outbound one','accepted',$1)`,
    [acceptedAtOne, acceptedAtTwo],
  );
  await pg.query(
    `INSERT INTO inbound_email_messages (provider_message_id,conversation_id,sender_id,message_id,received_at)
     VALUES ('fixture-provider-id',103,10,203,$1)`,
    [receivedAt],
  );
  // This thread is archived only for this viewer. Its messages must remain in
  // the shared history, and the group itself must remain in the active list.
  await pg.query(
    "INSERT INTO conversation_archives (conversation_id,staff_id) VALUES (102,1)",
  );
  await pg.query(
    "INSERT INTO conversation_participants (conversation_id,staff_id,last_read_at) VALUES (101,1,'2026-09-01T14:00:00Z')",
  );
}

before(async () => {
  // Isolated synthetic values exercise inbound authentication without reading
  // or contacting a real SendGrid account.
  process.env.SENDGRID_INBOUND_WEBHOOK_SECRET = "fixture-only-webhook-secret-with-32-chars";
  process.env.SENDGRID_REPLY_TOKEN_SECRET = "fixture-only-reply-token-secret-with-32-chars";
  process.env.SENDGRID_INBOUND_DOMAIN = "mail.fixture.marvol.test";
  pg = await PGlite.create();
  db = drizzle(pg, { schema });
  mock.module(new URL("../lib/db/src/index.ts", import.meta.url).href, {
    namedExports: { db },
  });
  mock.module(new URL("../artifacts/api-server/src/lib/actorSession.ts", import.meta.url).href, {
    namedExports: {
      actorStaffFromRequest: async (req: any) =>
        people.find((person) =>
          person.id === Number(req.header("x-test-actor")) &&
          person.active && person.loginEnabled && !person.formerEmployee,
        ) ?? null,
    },
  });
  ({ default: messagesRouter, inboundSendgridRouter } = await import("../artifacts/api-server/src/routes/messages.ts"));
  await createFixtureTables();
  await seedFixtures();
  const app = express();
  app.use(express.json());
  app.use("/api/webhooks/sendgrid/inbound", inboundSendgridRouter);
  app.use("/api", messagesRouter);
  app.use((_error: Error, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: "Isolated messages route failed" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  origin = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(resolve));
  if (pg) await pg.close();
});

async function request(path: string, actor: number, method = "GET", body?: unknown) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-test-actor": String(actor),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    data: text ? JSON.parse(text) : null,
  };
}

const messagesFor = (actor: number) =>
  request(`/conversations/101/messages?staffId=${actor}`, actor);
const sharedSummary = (rows: any[]) => rows.find((row) => row.otherStaffRole === "inspector");

test("admin and supervisor HTTP history merges all three original threads and preserves email timestamps", async () => {
  for (const actor of [1, 2]) {
    const list = await request(`/conversations?staffId=${actor}`, actor);
    assert.equal(list.status, 200);
    assert.equal(sharedSummary(list.data)?.id, 101);

    const result = await messagesFor(actor);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.map((message: any) => message.id), [201, 202, 203]);
    assert.equal(result.data.some((message: any) => message.id === 204), false);
    assert.equal(result.data[0].inspectorEmailDeliveryStatus, "accepted");
    assert.equal(result.data[0].inspectorEmailAcceptedAt, acceptedAtOne);
    assert.equal(result.data[1].inspectorEmailAcceptedAt, acceptedAtTwo);
    assert.equal(result.data[2].inboundEmailReceivedAt, receivedAt);
  }

  const active = await request("/conversations?staffId=1&archived=false", 1);
  const archived = await request("/conversations?staffId=1&archived=true", 1);
  assert.ok(sharedSummary(active.data), "a partially archived shared group stays active");
  assert.equal(sharedSummary(archived.data), undefined);
});

test("ordinary staff and the inspector cannot read an unrelated conversation", async () => {
  const ordinaryStaff = await request("/conversations/101/messages?staffId=3", 3);
  assert.equal(ordinaryStaff.status, 403);
  const staffList = await request("/conversations?staffId=3", 3);
  assert.equal(sharedSummary(staffList.data), undefined);

  const inspectorList = await request("/conversations?staffId=10", 10);
  assert.equal(inspectorList.status, 200);
  assert.equal(inspectorList.data.some((row: any) => row.id === 104), false);
  const unrelated = await request("/conversations/104/messages?staffId=10", 10);
  assert.equal(unrelated.status, 403);
});

test("read markers stay per viewer and per original thread; marking read updates only that viewer", async () => {
  const adminHistory = await messagesFor(1);
  const adminReadById = new Map(adminHistory.data.map((message: any) => [message.id, message.isRead]));
  assert.equal(adminReadById.get(201), true);
  assert.equal(adminReadById.get(202), false);

  const supervisorHistory = await messagesFor(2);
  const supervisorReadById = new Map(supervisorHistory.data.map((message: any) => [message.id, message.isRead]));
  assert.equal(supervisorReadById.get(201), false);
  assert.equal(supervisorReadById.get(202), true);

  const marked = await request("/conversations/101/read", 1, "POST", { staffId: 1 });
  assert.equal(marked.status, 200);
  const adminRows = await pg.query<any>(
    "SELECT conversation_id FROM conversation_participants WHERE staff_id=1 ORDER BY conversation_id",
  );
  assert.deepEqual(adminRows.rows.map((row: any) => row.conversation_id), ids);
  const supervisorRows = await pg.query<any>(
    "SELECT conversation_id FROM conversation_participants WHERE staff_id=2",
  );
  assert.equal(supervisorRows.rows.length, 0);
  const stillUnreadForSupervisor = await messagesFor(2);
  assert.equal(stillUnreadForSupervisor.data.find((message: any) => message.id === 201).isRead, false);
});

test("archive and unarchive operate on all three threads without removing history", async () => {
  const archived = await request("/conversations/101/archive", 1, "PATCH", {
    staffId: 1,
    archived: true,
  });
  assert.equal(archived.status, 200);
  const archiveRows = await pg.query<any>(
    "SELECT conversation_id FROM conversation_archives WHERE staff_id=1 ORDER BY conversation_id",
  );
  assert.deepEqual(archiveRows.rows.map((row: any) => row.conversation_id), ids);

  const activeList = await request("/conversations?staffId=1&archived=false", 1);
  const archivedList = await request("/conversations?staffId=1&archived=true", 1);
  assert.equal(sharedSummary(activeList.data), undefined);
  assert.equal(sharedSummary(archivedList.data)?.id, 101);
  assert.deepEqual((await messagesFor(1)).data.map((message: any) => message.id), [201, 202, 203]);

  const restored = await request("/conversations/101/archive", 1, "PATCH", {
    staffId: 1,
    archived: false,
  });
  assert.equal(restored.status, 200);
  const remaining = await pg.query<any>(
    "SELECT conversation_id FROM conversation_archives WHERE staff_id=1 ORDER BY conversation_id",
  );
  assert.equal(remaining.rows.length, 0);
  assert.ok(sharedSummary((await request("/conversations?staffId=1", 1)).data));
});

test("message edits and deletes require the message's original thread ID", async () => {
  const wrongEditThread = await request("/conversations/101/messages/202", 2, "PATCH", {
    senderId: 2,
    body: "edited fixture message",
  });
  assert.equal(wrongEditThread.status, 403);

  const edit = await request("/conversations/102/messages/202", 2, "PATCH", {
    senderId: 2,
    body: "edited fixture message",
  });
  assert.equal(edit.status, 200);
  assert.equal(edit.data.conversationId, 102);
  assert.equal(edit.data.body, "edited fixture message");

  const wrongDeleteThread = await request("/conversations/101/messages/202?staffId=1", 1, "DELETE");
  assert.equal(wrongDeleteThread.status, 403);

  // Exercise the successful DELETE route only inside a rollback-only PGlite
  // transaction. No operational or production message is deleted.
  await pg.exec("BEGIN");
  try {
    const deletion = await request("/conversations/102/messages/202?staffId=1", 1, "DELETE");
    assert.equal(deletion.status, 200);
    assert.equal(deletion.data.deleted, true);
    const insideTransaction = await pg.query<any>("SELECT id FROM messages WHERE id=202");
    assert.equal(insideTransaction.rows.length, 0);
  } finally {
    await pg.exec("ROLLBACK");
  }
  const restoredFixture = await pg.query<any>("SELECT id FROM messages WHERE id=202");
  assert.equal(restoredFixture.rows.length, 1);
});

test("receipt acknowledgment authenticates the inspector, is idempotent, and preserves provider status", async () => {
  const unauthenticated = await request("/conversations/101/messages/201/receipt", 0, "POST");
  assert.equal(unauthenticated.status, 401);

  const selfConfirmation = await request("/conversations/101/messages/201/receipt", 1, "POST");
  assert.equal(selfConfirmation.status, 403);

  const unrelatedConversation = await request("/conversations/104/messages/201/receipt", 3, "POST");
  assert.equal(unrelatedConversation.status, 403);

  const inspectorRecord = people.find((person) => person.id === 10)!;
  inspectorRecord.active = false;
  const inactiveInspector = await request("/conversations/101/messages/201/receipt", 10, "POST");
  assert.equal(inactiveInspector.status, 401);
  inspectorRecord.active = true;
  inspectorRecord.formerEmployee = true;
  const formerInspector = await request("/conversations/101/messages/201/receipt", 10, "POST");
  assert.equal(formerInspector.status, 401);
  inspectorRecord.formerEmployee = false;

  const confirmation = await request("/conversations/101/messages/201/receipt", 10, "POST", {
    staffId: 1,
    confirmerStaffId: 1,
  });
  assert.equal(confirmation.status, 201);
  assert.equal(confirmation.data.alreadyConfirmed, false);
  assert.equal(confirmation.data.receipt.direction, "to_inspector");
  assert.equal(confirmation.data.receipt.status, "confirmed");
  assert.deepEqual(confirmation.data.receipt.confirmedBy, {
    name: "Test Inspector",
    role: "inspector",
  });
  assert.ok(Number.isFinite(Date.parse(confirmation.data.receipt.confirmedAt)));

  const duplicate = await request("/conversations/101/messages/201/receipt", 10, "POST");
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.alreadyConfirmed, true);
  assert.equal(duplicate.data.receipt.confirmedAt, confirmation.data.receipt.confirmedAt);

  const stored = await pg.query<any>(
    "SELECT message_version, confirmed_by_staff_id FROM message_receipt_acknowledgements WHERE message_id=201",
  );
  assert.deepEqual(stored.rows, [{ message_version: 1, confirmed_by_staff_id: 10 }]);

  const history = await messagesFor(2);
  const outbound = history.data.find((message: any) => message.id === 201);
  assert.equal(outbound.receipt.status, "confirmed");
  assert.equal(outbound.receipt.confirmedBy.name, "Test Inspector");
  assert.equal(outbound.inspectorEmailDeliveryStatus, "accepted");
  assert.equal(outbound.inspectorEmailAcceptedAt, acceptedAtOne);
  assert.equal(outbound.inspectorEmailRecipients.length, 2);
});

test("authorized manager confirms inbound inspector email across shared history", async () => {
  const inspectorSelfConfirmation = await request("/conversations/102/messages/203/receipt", 10, "POST");
  assert.equal(inspectorSelfConfirmation.status, 403);

  const confirmation = await request("/conversations/102/messages/203/receipt", 2, "POST", {
    staffId: 11,
  });
  assert.equal(confirmation.status, 201);
  assert.equal(confirmation.data.receipt.direction, "from_inspector");
  assert.equal(confirmation.data.receipt.status, "confirmed");
  assert.deepEqual(confirmation.data.receipt.confirmedBy, {
    name: "Test Supervisor",
    role: "supervisor",
  });

  const history = await messagesFor(1);
  const inbound = history.data.find((message: any) => message.id === 203);
  assert.equal(inbound.receipt.status, "confirmed");
  assert.equal(inbound.inboundEmailReceivedAt, receivedAt);
});

test("message edits advance receipt versions and retain prior evidence through cleanup", async () => {
  const edit = await request("/conversations/101/messages/201", 1, "PATCH", {
    senderId: 1,
    body: "edited after the first receipt",
  });
  assert.equal(edit.status, 200);
  assert.equal(edit.data.receiptVersion, 2);
  assert.equal(edit.data.receipt.status, "unconfirmed");
  assert.deepEqual(edit.data.receipt.previousVersions.map((item: any) => item.version), [1]);
  assert.equal(edit.data.receipt.previousVersions[0].confirmedBy.name, "Test Inspector");

  const cleanup = await request(
    "/conversations/101/old-messages?before=2026-09-02T00:00:00.000Z",
    1,
    "DELETE",
  );
  assert.equal(cleanup.status, 200);
  assert.deepEqual(cleanup.data, { deleted: 0, retained: 1 });

  const deleteAcknowledged = await request("/conversations/101/messages/201?staffId=1", 1, "DELETE");
  assert.equal(deleteAcknowledged.status, 409);

  const secondConfirmation = await request("/conversations/101/messages/201/receipt", 10, "POST");
  assert.equal(secondConfirmation.status, 201);
  assert.equal(secondConfirmation.data.receipt.version, 2);
  assert.equal(secondConfirmation.data.receipt.status, "confirmed");
  assert.deepEqual(secondConfirmation.data.receipt.previousVersions.map((item: any) => item.version), [1]);

  const auditRows = await pg.query<any>(
    "SELECT message_version, confirmed_by_staff_id FROM message_receipt_acknowledgements WHERE message_id=201 ORDER BY message_version",
  );
  assert.deepEqual(auditRows.rows, [
    { message_version: 1, confirmed_by_staff_id: 10 },
    { message_version: 2, confirmed_by_staff_id: 10 },
  ]);
});

test("additive receipt schema preserves legacy messages and does not cascade-delete audit evidence", async () => {
  const migrationPg = await PGlite.create();
  const dialect = new PgDialect();
  const defaultSql = (column: any) => {
    if (column.default === undefined) return "";
    if (is(column.default, SQL)) return ` DEFAULT ${dialect.sqlToQuery(column.default).sql}`;
    if (typeof column.default === "string") return ` DEFAULT '${column.default.replaceAll("'", "''")}'`;
    return ` DEFAULT ${String(column.default)}`;
  };
  const definition = (column: any) =>
    `${quote(column.name)} ${column.getSQLType()}${column.notNull ? " NOT NULL" : ""}${column.primary ? " PRIMARY KEY" : ""}${defaultSql(column)}`;

  try {
    const messagesConfig = getTableConfig(schema.messagesTable);
    const versionColumn = messagesConfig.columns.find((column: any) => column.name === "receipt_version");
    assert.ok(versionColumn, "message schema declares a version column");
    assert.equal(versionColumn.default, 1, "legacy messages migrate as version 1");

    await migrationPg.exec(`CREATE TABLE "messages" (${messagesConfig.columns
      .filter((column: any) => column.name !== "receipt_version")
      .map(definition)
      .join(", ")})`);
    await migrationPg.exec(
      `INSERT INTO "messages" ("id","conversation_id","sender_id","body") VALUES (901,902,903,'legacy message')`,
    );
    await migrationPg.exec(`ALTER TABLE "messages" ADD COLUMN ${definition(versionColumn)}`);

    const receiptConfig = getTableConfig(schema.messageReceiptAcknowledgementsTable);
    await migrationPg.exec(`CREATE TABLE ${quote(receiptConfig.name)} (${receiptConfig.columns.map(definition).join(", ")})`);
    await migrationPg.exec(
      `CREATE UNIQUE INDEX "message_receipt_acknowledgements_message_version_unique" ON "message_receipt_acknowledgements" ("message_id","message_version")`,
    );

    const legacy = await migrationPg.query<any>('SELECT id, body, receipt_version FROM "messages" WHERE id=901');
    assert.deepEqual(legacy.rows, [{ id: 901, body: "legacy message", receipt_version: 1 }]);

    await migrationPg.query(
      `INSERT INTO "message_receipt_acknowledgements"
       (conversation_id,message_id,message_version,body_sha256,direction,confirmed_by_staff_id,confirmed_by_name,confirmed_by_role)
       VALUES (902,901,1,$1,'to_inspector',10,'Test Inspector','inspector')`,
      ["a".repeat(64)],
    );
    await migrationPg.exec('DELETE FROM "messages" WHERE id=901');
    const evidence = await migrationPg.query<any>(
      `SELECT conversation_id,message_id,message_version,confirmed_by_name
       FROM "message_receipt_acknowledgements" WHERE message_id=901`,
    );
    assert.deepEqual(evidence.rows, [{
      conversation_id: 902,
      message_id: 901,
      message_version: 1,
      confirmed_by_name: "Test Inspector",
    }]);
  } finally {
    await migrationPg.close();
  }
});

test("authenticated Moussa email enters the existing shared history once; spoofs and lookalikes are rejected", async () => {
  const recipientList = await request("/inspector-email/recipients", 1);
  assert.equal(recipientList.status, 200);
  assert.equal(recipientList.data.emails.includes("moussa.barmaki@goaa.org"), true);
  assert.equal(recipientList.data.emails.length, 11);

  const webhookPath = "/webhooks/sendgrid/inbound/";
  const inboundSecret = "fixture-only-webhook-secret-with-32-chars";
  const approvedFrom = "Moussa Barmaki <MOUSSA.BARMAKI@GOAA.ORG>";
  const payload = {
    envelope: {
      from: "moussa.barmaki@goaa.org",
      to: ["inspector@mail.fixture.marvol.test"],
    },
    from: approvedFrom,
    text: "Fixture inbound message for route validation; no real email content.",
    subject: "Synthetic sender authorization test",
    headers: "Message-ID: <moussa-route-fixture-1@example.test>",
    SPF: "pass",
  };
  const submit = async (body: unknown, secret = inboundSecret) => {
    const response = await fetch(`${origin}${webhookPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sendgrid-inbound-secret": secret,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  };

  const badCredential = await submit(payload, "incorrect-fixture-credential");
  assert.equal(badCredential.status, 401);

  const spoofedFrom = await submit({
    ...payload,
    envelope: { ...payload.envelope, from: "attacker@goaa.org" },
    headers: "Message-ID: <moussa-route-spoof@example.test>",
  });
  assert.equal(spoofedFrom.status, 403);

  const lookalike = await submit({
    ...payload,
    envelope: { ...payload.envelope, from: "moussa.barmaki@goaa.org.evil.test" },
    from: "Moussa <moussa.barmaki@goaa.org.evil.test>",
    headers: "Message-ID: <moussa-route-lookalike@example.test>",
  });
  assert.equal(lookalike.status, 403);

  const accepted = await submit(payload);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.duplicate, false);
  assert.ok(Number.isInteger(accepted.data.messageId));

  const duplicate = await submit(payload);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.duplicate, true);
  assert.equal(duplicate.data.messageId, accepted.data.messageId);

  const stored = await pg.query<any>(
    "SELECT id, conversation_id, sender_id, body FROM messages WHERE id=$1",
    [accepted.data.messageId],
  );
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0].conversation_id, 101);
  assert.equal(stored.rows[0].sender_id, 10);
  assert.match(stored.rows[0].body, /^From inspector: moussa\.barmaki@goaa\.org/);

  const history = await messagesFor(2);
  const routed = history.data.find((message: any) => message.id === accepted.data.messageId);
  assert.ok(routed, "the accepted message appears in the existing shared manager history");
  assert.ok(routed.inboundEmailReceivedAt);
  assert.equal(routed.receipt.direction, "from_inspector");
  assert.equal(routed.receipt.status, "unconfirmed");
  assert.equal(routed.receipt.canConfirm, true);

  const inboundCount = await pg.query<any>(
    "SELECT count(*)::int AS count FROM inbound_email_messages WHERE message_id=$1",
    [accepted.data.messageId],
  );
  assert.equal(inboundCount.rows[0].count, 1);
});
