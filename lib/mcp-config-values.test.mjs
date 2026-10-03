import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const values = await jiti.import("./mcp-config-values.ts");
const transport = await jiti.import("./mcp-transport.ts");

test("finds the PI_WEB_PASSWORD reference in resolved values", () => {
  const parsers = {
    isCommandConfigValue: (value) => value.startsWith("!"),
    getConfigValueEnvVarNames: (value) => [...value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]),
  };

  assert.deepEqual(values.findWebPasswordField({ command: "srv", env: { TOKEN: "${PI_WEB_PASSWORD}" } }, parsers), {
    kind: "env",
    name: "TOKEN",
  });
  assert.deepEqual(values.findWebPasswordField({ command: "srv", env: { TOKEN: "!print PI_WEB_PASSWORD" } }, parsers), {
    kind: "env",
    name: "TOKEN",
  });
  assert.deepEqual(
    values.findWebPasswordField({ url: "https://x/mcp", headers: { Authorization: "Bearer ${pi_web_password}" } }, parsers),
    { kind: "header", name: "Authorization" },
  );
  assert.deepEqual(
    values.findWebPasswordField({ url: "https://x/mcp", oauth: { clientSecret: "${PI_WEB_PASSWORD}" } }, parsers),
    { kind: "oauth-client-secret" },
  );

  for (const value of ["${PI_WEB_PASSWORD_HINT}", "literal PI_WEB_PASSWORD", "Bearer ${TOKEN}"]) {
    assert.equal(values.findWebPasswordField({ command: "srv", env: { TOKEN: value } }, parsers), undefined, value);
  }
  assert.deepEqual(values.findWebPasswordField(null, parsers), undefined);
  assert.deepEqual(values.findWebPasswordField({ command: "srv" }, parsers), undefined);
});

test("walks resolved values as the SDK resolves them, on unvalidated entries too", () => {
  assert.deepEqual(values.resolvedConfigValues({ command: "srv", env: { A: "1", B: 2, C: "${C}" }, headers: { H: "ignored" } }), [
    { kind: "env", name: "A", value: "1" },
    { kind: "env", name: "C", value: "${C}" },
  ]);
  assert.deepEqual(
    values.resolvedConfigValues({ url: "https://x/mcp", env: { A: "ignored" }, headers: { H: "v" }, oauth: { clientSecret: "s" } }),
    [{ kind: "header", name: "H", value: "v" }, { kind: "oauth-client-secret", value: "s" }],
  );
  for (const config of [null, "string", [], { env: "not a map" }, { url: 1, headers: ["x"], oauth: "x" }]) {
    assert.deepEqual(values.resolvedConfigValues(config), [], JSON.stringify(config));
  }
});

test("the transport re-exports the resolved-value walk, never its own copy", () => {
  assert.equal(transport.resolvedConfigValues, values.resolvedConfigValues);
  assert.equal(transport.findWebPasswordField, values.findWebPasswordField);
  assert.equal(transport.WEB_PASSWORD_VARIABLE, values.WEB_PASSWORD_VARIABLE);
});
