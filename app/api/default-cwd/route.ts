import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { allowFileRoot } from "@/lib/file-access";
import { defaultCwdPath } from "@/lib/default-cwd";
import { isApiRequestAllowed } from "@/lib/request-security";

// POST /api/default-cwd
// Creates ~/pi-cwd/<YYYYMMDD> (local date) if it doesn't exist and returns the path.
// The parent and the dated folder are both registered as file allow-roots; older
// ~/pi-cwd-YYYYMMDD folders stay browsable through the home scan in file-access.
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  try {
    const dir = defaultCwdPath();
    mkdirSync(dir, { recursive: true });
    allowFileRoot(dir);
    // The parent too, so sibling date folders appear once created elsewhere.
    allowFileRoot(dir.replace(/[\\/]\d{8}$/, ""));
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
