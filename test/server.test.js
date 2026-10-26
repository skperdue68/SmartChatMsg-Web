import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";
test("local server serves app and blocks mutation, traversal and foreign hosts", async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const root = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(root)).status, 200);
    assert.equal(
      (await fetch(root, { method: "POST", body: "ignored" })).status,
      405,
    );
    assert.equal((await fetch(root + "/src/server.js")).status, 404);
    assert.equal(
      await new Promise((resolve, reject) =>
        http
          .get(root, { headers: { host: "evil.example" } }, (r) => {
            r.resume();
            resolve(r.statusCode);
          })
          .on("error", reject),
      ),
      403,
    );
    assert.equal(
      (await fetch(root, { headers: { origin: "https://evil.example" } }))
        .status,
      403,
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});
