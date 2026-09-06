import { getSessionListVersion } from "@/lib/session-reader";
import { getRunningRpcSessionIds } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { sessionListVersion: getSessionListVersion(), runningSessionIds: getRunningRpcSessionIds() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
