import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import storageRouter from "./storage";

test("generic private-object serving rejects the dedicated operations-workbooks prefix", async () => {
  const app = express();
  app.use(storageRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/storage/objects/operations-workbooks/uniform-inventory-system.xlsx`,
    );
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Object not found" });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
});
