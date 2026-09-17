import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { jsonResponse } = await jiti.import("./json-response.ts");

function requestWithEncoding(acceptEncoding) {
  return new Request("http://localhost/", { headers: acceptEncoding ? { "Accept-Encoding": acceptEncoding } : {} });
}

test("does not gzip small responses", async () => {
  const response = jsonResponse(requestWithEncoding("gzip"), { ok: true });
  assert.equal(response.headers.get("Content-Encoding"), null);
  assert.equal(response.headers.get("Vary"), null);
  assert.equal(await response.text(), JSON.stringify({ ok: true }));
});

test("gzip-compresses large responses when the client accepts it", async () => {
  const big = { data: "x".repeat(4096) };
  const response = jsonResponse(requestWithEncoding("gzip"), big);
  assert.equal(response.headers.get("Content-Encoding"), "gzip");
  assert.match(response.headers.get("Vary") ?? "", /Accept-Encoding/);
  const buffer = Buffer.from(await response.arrayBuffer());
  // Gzip magic bytes.
  assert.equal(buffer[0], 0x1f);
  assert.equal(buffer[1], 0x8b);
});

test("does not gzip when the client rejects or omits gzip", async () => {
  const big = { data: "x".repeat(4096) };
  const noGzip = jsonResponse(requestWithEncoding("br"), big);
  assert.equal(noGzip.headers.get("Content-Encoding"), null);
  const omitted = jsonResponse(requestWithEncoding(""), big);
  assert.equal(omitted.headers.get("Content-Encoding"), null);
  assert.equal(JSON.parse(await omitted.text()).data.length, 4096);
});

test("honors an explicit gzip quality of 0", async () => {
  const big = { data: "x".repeat(4096) };
  const response = jsonResponse(requestWithEncoding("gzip;q=0, *;q=1"), big);
  assert.equal(response.headers.get("Content-Encoding"), null);
});
