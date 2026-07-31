import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildApiKeyProviderList, buildOAuthProviderList } = await createJiti(import.meta.url).import("./provider-listing.ts");
const provider = (overrides = {}) => ({
  id: "anthropic", name: "Anthropic", hasApiKeyLogin: true, hasOAuth: true,
  oauthName: "Anthropic (Claude Pro/Max)", status: { configured: false }, modelCount: 12, ...overrides,
});

test("lists dual-auth providers according to their stored credential type", () => {
  const apiKeyCredential = [provider({ status: { configured: true, source: "stored" }, credentialType: "api_key" })];
  assert.equal(buildApiKeyProviderList(apiKeyCredential)[0].configured, true);
  assert.equal(buildOAuthProviderList(apiKeyCredential)[0].loggedIn, false);

  const oauthCredential = [provider({ status: { configured: true, source: "stored" }, credentialType: "oauth" })];
  assert.equal(buildApiKeyProviderList(oauthCredential)[0].configured, false);
  assert.equal(buildOAuthProviderList(oauthCredential)[0].loggedIn, true);
});

test("keeps custom models.json providers out of generic API-key configuration", () => {
  assert.deepEqual(buildApiKeyProviderList([
    provider({ id: "custom-key", status: { configured: true, source: "models_json_key" } }),
    provider({ id: "custom-command", status: { configured: true, source: "models_json_command" } }),
  ]), []);
});
