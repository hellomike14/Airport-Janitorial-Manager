// Run with: TEST_INBOX_DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/api-server exec tsx ../../scripts/verify-inspector-inbox.mjs
// No mail is sent. All fixture rows and sequences live in a new disposable schema.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const requireDb = createRequire(new URL('../lib/db/package.json', import.meta.url));
const requireApi = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url));
const { Pool } = requireDb('pg');
const express = requireApi('express');
if (!process.env.TEST_INBOX_DATABASE_URL) throw new Error('TEST_INBOX_DATABASE_URL is required; use a development database');
const control = new Pool({ connectionString: process.env.TEST_INBOX_DATABASE_URL });
const schema = `inbox_test_${randomUUID().replaceAll('-', '')}`;
const tables = ['staff', 'conversations', 'messages', 'notifications', 'inbound_email_messages', 'conversation_archives', 'conversation_participants', 'inspector_task_links', 'areas'];
let pool, server;
try {
  await control.query(`CREATE SCHEMA "${schema}"`);
  for (const table of tables) {
    await control.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    const { rows } = await control.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_default LIKE $3', [schema, table, 'nextval%']);
    for (const { column_name: column } of rows) {
      assert.match(column, /^[a-z_]+$/);
      const sequence = `${table}_${column}_seq`;
      await control.query(`CREATE SEQUENCE "${schema}"."${sequence}"`);
      await control.query(`ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" SET DEFAULT nextval('"${schema}"."${sequence}"')`);
    }
  }
  const url = new URL(process.env.TEST_INBOX_DATABASE_URL);
  // No public fallback: a missing fixture table must fail rather than touch real rows.
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  process.env.SENDGRID_EMAIL_BRIDGE_ENABLED = 'off';
  process.env.SENDGRID_INBOUND_DOMAIN = 'replies.marvolenterprises.com';
  process.env.SENDGRID_INBOUND_WEBHOOK_SECRET = 'isolated-inbox-test-secret-'.repeat(2);
  process.env.SENDGRID_REPLY_TOKEN_SECRET = 'isolated-inbox-reply-secret-'.repeat(2);
  ({ pool } = await import('../lib/db/src/index.ts'));
  assert.equal((await pool.query('select current_schema() as name')).rows[0].name, schema);
  await pool.query(`INSERT INTO staff (id,name,role,email) VALUES
    (1,'Fixture admin','admin','admin@example.test'),
    (2,'Fixture supervisor','supervisor','supervisor@example.test'),
    (3,'Inspector mailbox','inspector','inspector@marvolenterprises.com'),
    (4,'Fixture worker','staff','worker@example.test')`);
  await pool.query(`INSERT INTO conversations (id,participant_a_id,participant_b_id) VALUES (10,1,3)`);
  await pool.query(`INSERT INTO conversation_archives (conversation_id,staff_id) VALUES (10,1),(10,2)`);
  const { inboundSendgridRouter } = await import('../artifacts/api-server/src/routes/messages.ts');
  const { inboundParseMiddleware } = await import('../artifacts/api-server/src/lib/inboundParseMiddleware.ts');
  const { createReplyToken } = await import('../artifacts/api-server/src/lib/sendgridEmailBridge.ts');
  const { canReadSharedInspector } = await import('../artifacts/api-server/src/lib/sharedInspectorConversation.ts');
  const app = express(); app.use('/inbound', inboundParseMiddleware, inboundSendgridRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/inbound`;
  const post = (id, recipient = 'inspector@replies.marvolenterprises.com', dkim = '{@goaa.org : pass}') => fetch(base, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-sendgrid-inbound-secret': process.env.SENDGRID_INBOUND_WEBHOOK_SECRET },
    body: JSON.stringify({ envelope: { from: 'SRS0=fixture@marvolenterprises.com', to: [recipient] }, from: '"Maynard, Ashley" <Ashley.Maynard@GOAA.org>',
      subject: 'Isolated intake fixture', text: 'A newly composed email. '.repeat(120), headers: `Message-ID: <${id}@example.test>`, SPF: 'pass', dkim }),
  });
  assert.equal((await post('rejected', undefined, '{@marvolenterprises.com : pass}')).status, 403);
  const responses = await Promise.all([post('same-message'), post('same-message')]);
  const bodies = await Promise.all(responses.map(async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); }));
  assert.equal(bodies.filter(body => body.duplicate).length, 1);
  const { rows: stored } = await pool.query('select * from messages');
  assert.equal(stored.length, 1); assert.equal(stored[0].conversation_id, 10);
  assert.match(stored[0].body, /From inspector: ashley.maynard@goaa.org\nSubject: Isolated intake fixture/);
  assert.equal((await pool.query('select count(*)::int as n from conversation_archives')).rows[0].n, 0);
  const urgent = (await pool.query("select staff_id from notifications where type='inspector_to_supervisor' order by staff_id")).rows;
  assert.deepEqual(urgent.map(row => row.staff_id), [1, 2]);
  const token = createReplyToken({ conversationId: 10, inspectorId: 3, supervisorId: 1, expiresAt: Math.floor(Date.now()/1000)+300 }, process.env.SENDGRID_REPLY_TOKEN_SECRET);
  assert.equal((await post('signed-reply', `reply+${token}@replies.marvolenterprises.com`)).status, 200);
  assert.equal((await post('invalid-token', 'reply+unsigned@replies.marvolenterprises.com')).status, 403);
  assert.equal((await pool.query('select count(*)::int as n from messages')).rows[0].n, 2);
  const thread = { isGroup: false, participantAId: 1, participantBId: 3 };
  const people = [{ id: 1, role: 'admin' }, { id: 3, role: 'inspector', email: 'inspector@marvolenterprises.com' }];
  for (const role of ['admin','supervisor','staff','inspector']) {
    assert.equal(canReadSharedInspector({ id: 90, role, active: true, loginEnabled: true, formerEmployee: false }, thread, people), ['admin','supervisor'].includes(role));
  }
  console.log('PASS: actual inbound HTTP handler + isolated PostgreSQL: forwarded first email, concurrent duplicate, subject/sender/body persistence, both manager alerts, archive recovery, signed reply and rejected spoof/token. No email sent.');
} finally {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (pool) await pool.end();
  assert.match(schema, /^inbox_test_[a-f0-9]{32}$/);
  await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await control.end();
}
