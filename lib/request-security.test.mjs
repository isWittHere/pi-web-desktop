import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { isApiRequestAllowed, hasJsonContentType } = await createJiti(import.meta.url).import("./request-security.ts");

function request(headers, path = "/api/test") {
  return new Request(`http://localhost:30141${path}`, { method: "POST", headers });
}

test("allows same-origin and non-browser requests to trusted hosts", () => {
  assert.equal(isApiRequestAllowed(request({ host: "localhost:30141" })), true);
  assert.equal(isApiRequestAllowed(request({
    host: "192.168.1.2:30141", origin: "http://192.168.1.2:30141", "sec-fetch-site": "same-origin",
  })), true);
});

test("rejects cross-origin and DNS-rebound browser API requests", () => {
  assert.equal(isApiRequestAllowed(request({
    host: "localhost:30141", origin: "https://attacker.example", "sec-fetch-site": "cross-site",
  })), false);
  assert.equal(isApiRequestAllowed(request({
    host: "attacker.example:30141", origin: "http://attacker.example:30141", "sec-fetch-site": "same-origin",
  })), false);
});

test("does not globally trust opaque DOCX iframes or alternate loopback origins", () => {
  const previewPath = "/api/files/tmp/test.docx?type=preview";
  assert.equal(isApiRequestAllowed(request({
    host: "localhost:30141",
    origin: "null",
    "sec-fetch-site": "cross-site",
    "sec-fetch-mode": "navigate",
    "sec-fetch-dest": "iframe",
  }, previewPath)), false);
  assert.equal(isApiRequestAllowed(request({
    host: "localhost:30141",
    origin: "http://127.0.0.1:30141",
    "sec-fetch-site": "cross-site",
  }, previewPath)), false);
});

test("allows explicitly configured hosts and rejects malformed host headers", () => {
  assert.equal(isApiRequestAllowed(request({
    host: "pi-web.internal:30141", origin: "http://pi-web.internal:30141", "sec-fetch-site": "same-origin",
  }), ["pi-web.internal"]), true);
  assert.equal(isApiRequestAllowed(request({ host: "localhost@attacker.example" })), false);
});

test("recognizes JSON and vendor JSON content types", () => {
  assert.equal(hasJsonContentType(request({ "content-type": "application/json; charset=utf-8" })), true);
  assert.equal(hasJsonContentType(request({ "content-type": "application/problem+json" })), true);
  assert.equal(hasJsonContentType(request({ "content-type": "text/plain" })), false);
});

test("allows a proxy that reports the scheme out-of-band and rewrites Origin", () => {
  // Azure Dev Tunnels normalizes Host and Origin onto the backend authority
  // but keeps the external scheme in x-forwarded-proto.
  const proxied = new Request("https://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://localhost:30141",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestAllowed(proxied), true);
});

test("still rejects a foreign origin when a proxy is in front", () => {
  const foreignHost = new Request("https://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://attacker.example",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-site",
    },
  });
  const foreignPort = new Request("https://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://localhost:30142",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-site",
    },
  });
  const alternateLoopback = new Request("https://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://127.0.0.1:30141",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-site",
    },
  });
  const opaque = new Request("https://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "null",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-site",
    },
  });

  assert.equal(isApiRequestAllowed(foreignHost), false);
  assert.equal(isApiRequestAllowed(foreignPort), false);
  assert.equal(isApiRequestAllowed(alternateLoopback), false);
  assert.equal(isApiRequestAllowed(opaque), false);
});

test("does not relax the scheme without a proxy in front", () => {
  const schemeMismatch = new Request("https://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://localhost:30141",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestAllowed(schemeMismatch), false);
});

test("does not relax the scheme without same-origin evidence", () => {
  const proxySameSite = new Request("https://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://localhost:30141",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-site",
    },
  });
  assert.equal(isApiRequestAllowed(proxySameSite), false);
});
