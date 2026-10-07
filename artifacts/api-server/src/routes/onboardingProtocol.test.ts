import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import { createOnboardingProtocolRouter } from "./onboardingProtocol";
import type { ObjectStorageService } from "../lib/objectStorage";

test("staff protocol delivery preserves PDF bytes, access control and explicit errors", async () => {
  const pdf = Buffer.from("%PDF-1.7\nonboarding protocol");
  let reads = 0;
  let unavailable = false;
  const storage: Pick<ObjectStorageService, "getObjectEntityFile"> = {
    async getObjectEntityFile(path) {
      reads++;
      assert.equal(path, "/objects/uploads/77cdc8b2-f557-4199-befb-4194df1cd299");
      if (unavailable) throw new Error("Unavailable");
      return { download: async () => [pdf] } as unknown as Awaited<ReturnType<ObjectStorageService["getObjectEntityFile"]>>;
    },
  };
  const app = express();
  app.use(createOnboardingProtocolRouter(storage, (req, res, next) => {
    if (!["admin", "supervisor", "staff", "inspector"].includes(String(req.headers["x-test-role"]))) {
      res.status(403).end();
      return;
    }
    next();
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/onboarding-protocol`;
  try {
    assert.equal((await fetch(url)).status, 403);
    for (const role of ["admin", "supervisor", "staff", "inspector"]) {
      for (const [query, disposition] of [["", "inline"], ["?download=1", "attachment"]]) {
        const response = await fetch(url + query, { headers: { "x-test-role": role } });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "application/pdf");
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.match(response.headers.get("content-disposition")!, new RegExp(`^${disposition};`));
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
      }
    }
    assert.equal((await fetch(url + "?download=invalid", { headers: { "x-test-role": "staff" } })).status, 400);
    assert.equal(reads, 8);
    unavailable = true;
    assert.equal((await fetch(url, { headers: { "x-test-role": "staff" } })).status, 503);
    assert.equal(reads, 9);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
