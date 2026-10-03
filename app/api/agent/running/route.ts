import { getSessionListVersion } from "@/lib/session-reader";
import { getRunningRpcSessionIds } from "@/lib/rpc-manager";
import { getModelsVersion } from "@/lib/models-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      sessionListVersion: getSessionListVersion(),
      runningSessionIds: getRunningRpcSessionIds(),
      modelsVersion: getModelsVersion(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
