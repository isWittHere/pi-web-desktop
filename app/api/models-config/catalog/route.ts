import { NextResponse } from "next/server";
import { flattenModelsDevCatalog, recommendModelCatalogPreset, type ModelCatalogEntry } from "@/lib/model-catalog";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const MODELS_DEV_URL = "https://models.dev/api.json";
const CATALOG_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_CATALOG_BYTES = 8 * 1024 * 1024;

type CatalogCache = {
  entries: ModelCatalogEntry[];
  expiresAt: number;
  inFlight?: Promise<ModelCatalogEntry[]>;
};

declare global {
  var __piModelsDevCatalogCache: CatalogCache | undefined;
}

function cache(): CatalogCache {
  return globalThis.__piModelsDevCatalogCache ??= { entries: [], expiresAt: 0 };
}

async function fetchCatalog(): Promise<ModelCatalogEntry[]> {
  // This is a fixed, anonymous request. User model/provider configuration and
  // credentials are never included in the request; matching happens locally.
  const response = await fetch(MODELS_DEV_URL, {
    cache: "no-store",
    redirect: "error",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Catalog is temporarily unavailable");
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) throw new Error("Catalog returned an invalid response");
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_CATALOG_BYTES) {
    throw new Error("Catalog response is too large");
  }
  const source = await response.text();
  if (Buffer.byteLength(source, "utf8") > MAX_CATALOG_BYTES) throw new Error("Catalog response is too large");
  let payload: unknown;
  try {
    payload = JSON.parse(source);
  } catch {
    throw new Error("Catalog returned invalid JSON");
  }
  const entries = flattenModelsDevCatalog(payload);
  if (!entries.length) throw new Error("Catalog is temporarily unavailable");
  return entries;
}

async function loadCatalog(): Promise<ModelCatalogEntry[]> {
  const current = cache();
  if (current.entries.length && current.expiresAt > Date.now()) return current.entries;
  if (!current.inFlight) {
    current.inFlight = fetchCatalog().then((entries) => {
      current.entries = entries;
      current.expiresAt = Date.now() + CATALOG_TTL_MS;
      return entries;
    }).finally(() => {
      current.inFlight = undefined;
    });
  }
  try {
    return await current.inFlight;
  } catch (error) {
    if (current.entries.length) return current.entries;
    throw error;
  }
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const modelId = (searchParams.get("modelId") ?? "").trim().slice(0, 200);
  const provider = (searchParams.get("provider") ?? "").trim().slice(0, 120);
  const baseUrl = (searchParams.get("baseUrl") ?? "").trim().slice(0, 500);
  if (!modelId) return NextResponse.json({ error: "modelId required" }, { status: 400 });

  try {
    const entries = await loadCatalog();
    const recommendation = recommendModelCatalogPreset(entries, modelId, provider, baseUrl);
    return NextResponse.json({ recommendation }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Model catalog is temporarily unavailable" }, { status: 502 });
  }
}
