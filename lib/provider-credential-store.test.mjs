import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { removeStoredCredentialIfType, storeProviderCredential } = await createJiti(import.meta.url)
  .import("./provider-credential-store.ts");

async function withAuthFile(data, run) {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-auth-"));
  const authPath = join(directory, "auth.json");
  await writeFile(authPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    await run(authPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("removes only a matching credential and preserves other providers", async () => {
  await withAuthFile({
    anthropic: { type: "api_key", key: "secret" },
    openai: { type: "api_key", key: "other" },
  }, async (authPath) => {
    assert.deepEqual(await removeStoredCredentialIfType("anthropic", "api_key", authPath), { status: "removed" });
    const stored = JSON.parse(await readFile(authPath, "utf8"));
    assert.deepEqual(stored, { openai: { type: "api_key", key: "other" } });
  });
});

test("reports a credential type mismatch instead of deleting another auth method", async () => {
  await withAuthFile({ anthropic: { type: "oauth", token: "new" } }, async (authPath) => {
    assert.deepEqual(await removeStoredCredentialIfType("anthropic", "api_key", authPath), {
      status: "type_mismatch", storedType: "oauth",
    });
    assert.equal(JSON.parse(await readFile(authPath, "utf8")).anthropic.token, "new");
  });
});

test("stores a provider credential while preserving other providers", async () => {
  await withAuthFile({
    anthropic: { type: "oauth", access: "old-token" },
    openai: { type: "api_key", key: "other" },
  }, async (authPath) => {
    await storeProviderCredential("anthropic", { type: "api_key", key: "replacement" }, authPath);
    assert.deepEqual(JSON.parse(await readFile(authPath, "utf8")), {
      anthropic: { type: "api_key", key: "replacement" },
      openai: { type: "api_key", key: "other" },
    });
  });
});
