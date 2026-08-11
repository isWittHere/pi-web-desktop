import { NextResponse } from "next/server";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { buildModelsListUrl, parseDiscoveredModels } from "@/lib/model-discovery";

export const dynamic = "force-dynamic";

const DISCOVERY_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function hasHeader(headers: Headers, name: string): boolean {
  return headers.has(name);
}

function buildHeaders(api: string, apiKey: string | undefined, configured: Record<string, string>): Headers {
  const headers = new Headers(configured);
  if (!hasHeader(headers, "accept")) headers.set("Accept", "application/json");
  if (!apiKey) return headers;

  if (api === "anthropic-messages") {
    if (!hasHeader(headers, "x-api-key")) headers.set("x-api-key", apiKey);
    if (!hasHeader(headers, "anthropic-version")) headers.set("anthropic-version", "2023-06-01");
  } else if (api === "google-generative-ai") {
    if (!hasHeader(headers, "x-goog-api-key")) headers.set("x-goog-api-key", apiKey);
  } else if (!hasHeader(headers, "authorization")) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  return headers;
}

/**
 * Resolves the effective credentials for discovery the same way the runtime
 * would: write a throwaway models.json with a dummy model and let ModelRuntime
 * resolve API keys (env var / shell command references included) and headers.
 */
async function resolveDiscoveryAuth(
  providerName: string,
  provider: Record<string, unknown>,
): Promise<{ apiKey?: string; headers: Record<string, string> }> {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-web-model-discovery-"));
  try {
    const modelsPath = join(tempDir, "models.json");
    const discoveryModelId = "__pi_web_model_discovery__";
    writeFileSync(modelsPath, JSON.stringify({
      providers: {
        [providerName]: {
          ...provider,
          models: [{ id: discoveryModelId }],
        },
      },
    }, null, 2), "utf8");

    const modelRuntime = await ModelRuntime.create({ modelsPath });
    const loadError = modelRuntime.getError();
    if (loadError) throw new Error(loadError);
    const model = modelRuntime.getModel(providerName, discoveryModelId);
    if (!model) throw new Error(`Unable to load provider "${providerName}"`);

    const resolved = await modelRuntime.getAuth(model);
    if (resolved) {
      return {
        apiKey: resolved.auth.apiKey,
        headers: stringRecord(resolved.auth.headers),
      };
    }

    // No stored credential — fall back to compatibility headers so providers
    // configured with headers-only credentials still work.
    return {
      headers: stringRecord(modelRuntime.getCompatibilityRequestConfig(model).headers),
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { providerName?: unknown; provider?: unknown };
    const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
    if (!providerName) return NextResponse.json({ error: "providerName is required" }, { status: 400 });
    if (!isRecord(body.provider)) return NextResponse.json({ error: "provider is required" }, { status: 400 });

    const baseUrl = typeof body.provider.baseUrl === "string" ? body.provider.baseUrl.trim() : "";
    if (!baseUrl) return NextResponse.json({ error: "Base URL is required" }, { status: 400 });
    const api = typeof body.provider.api === "string" && body.provider.api
      ? body.provider.api
      : "openai-completions";

    let endpoint: URL;
    try {
      endpoint = buildModelsListUrl(baseUrl, api);
    } catch {
      return NextResponse.json({ error: "Base URL is invalid" }, { status: 400 });
    }

    const auth = await resolveDiscoveryAuth(providerName, body.provider);
    if (typeof body.provider.apiKey === "string" && body.provider.apiKey.trim() && !auth.apiKey) {
      return NextResponse.json({ error: `No API key found for "${providerName}"` }, { status: 400 });
    }

    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: buildHeaders(api, auth.apiKey, auth.headers),
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    const responseText = await response.text();
    if (!response.ok) {
      return NextResponse.json({
        error: responseText.slice(0, 500) || `Upstream returned HTTP ${response.status}`,
        status: response.status,
      }, { status: 502 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      return NextResponse.json({ error: "Upstream model list was not valid JSON" }, { status: 502 });
    }
    const models = parseDiscoveredModels(payload);
    if (models.length === 0) {
      return NextResponse.json({ error: "No models found in the upstream response" }, { status: 502 });
    }

    return NextResponse.json({ models, endpoint: endpoint.toString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof DOMException && error.name === "TimeoutError" ? 504 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
