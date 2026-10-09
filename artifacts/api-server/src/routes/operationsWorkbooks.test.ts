import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import {
  createOperationsWorkbooksRouter,
} from "./operationsWorkbooks";

const fixtureBytes = Buffer.from("synthetic-uniform-workbook-fixture; no employee records");
const fixtureSha256 = createHash("sha256").update(fixtureBytes).digest("hex");

test("uniform workbook download requires a manager and preserves stored bytes", async () => {
  let actor: { id: number; role: "admin" | "supervisor" | "staff" | "inspector" } | null = null;
  let storageReads = 0;
  const app = express();
  app.use(createOperationsWorkbooksRouter({
    resolveActor: (async () => actor) as never,
    readUniformWorkbook: async () => {
      storageReads++;
      return fixtureBytes;
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/operations/workbooks/uniform`;
  try {
    const unauthenticated = await fetch(url);
    assert.equal(unauthenticated.status, 401);
    assert.equal(storageReads, 0);

    actor = { id: 21, role: "staff" };
    const staffResponse = await fetch(url);
    assert.equal(staffResponse.status, 403);
    assert.equal(storageReads, 0);

    actor = { id: 22, role: "inspector" };
    const inspectorResponse = await fetch(url);
    assert.equal(inspectorResponse.status, 403);
    assert.equal(storageReads, 0);

    for (const role of ["admin", "supervisor"] as const) {
      actor = { id: role === "admin" ? 1 : 2, role };
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      assert.equal(response.headers.get("content-disposition"), 'attachment; filename="Marvol_Uniform_inventory_system.xlsx"');
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(bytes, fixtureBytes);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), fixtureSha256);
    }
    assert.equal(storageReads, 2);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
});
