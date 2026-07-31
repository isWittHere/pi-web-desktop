import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ProviderCredentialType, ProviderListingInput } from "@/lib/provider-listing";

/** Converts ModelRuntime state into the pure provider-listing input contract. */
export async function collectProviderListingInputs(
  modelRuntime: ModelRuntime,
): Promise<ProviderListingInput[]> {
  const models = modelRuntime.getModels();
  const credentialTypes = new Map<string, ProviderCredentialType>();

  try {
    for (const credential of await modelRuntime.listCredentials()) {
      if (credential.type === "api_key" || credential.type === "oauth") {
        credentialTypes.set(credential.providerId, credential.type);
      }
    }
  } catch {
    // A malformed auth.json should not hide every provider from configuration.
  }

  return modelRuntime.getProviders().map((provider) => ({
    id: provider.id,
    name: provider.name,
    hasApiKeyLogin: Boolean(provider.auth.apiKey?.login),
    hasOAuth: Boolean(provider.auth.oauth),
    ...(provider.auth.oauth?.name ? { oauthName: provider.auth.oauth.name } : {}),
    status: modelRuntime.getProviderAuthStatus(provider.id),
    ...(credentialTypes.has(provider.id)
      ? { credentialType: credentialTypes.get(provider.id) }
      : {}),
    modelCount: models.filter((model) => model.provider === provider.id).length,
  }));
}
