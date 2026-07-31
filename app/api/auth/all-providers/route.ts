import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { buildApiKeyProviderList } from "@/lib/provider-listing";
import { collectProviderListingInputs } from "@/lib/provider-listing-runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const modelRuntime = await ModelRuntime.create();
  return Response.json({
    providers: buildApiKeyProviderList(await collectProviderListingInputs(modelRuntime)),
  });
}
