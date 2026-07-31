import { NextResponse } from "next/server";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import {
  MAX_INLINE_BASH_OUTPUT_BYTES,
  openRegularFileNoFollow,
  readUtf8FileWithinLimit,
  resolveBashOutputPath,
} from "@/lib/bash-output";
import { isBashOutputPathReferencedBySession } from "@/lib/session-file-references";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

// Reads only an SDK-created temp file already referenced by the requested session.
// Inline output is bounded; downloads stream the file without buffering it.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const { id } = await params;
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  const download = url.searchParams.get("download") === "1";
  if (!path) return NextResponse.json({ error: "path required" }, { status: 400 });

  const resolved = resolveBashOutputPath(path, tmpdir());
  if (!resolved) return NextResponse.json({ error: "invalid path" }, { status: 400 });
  if (!await isBashOutputPathReferencedBySession(resolved, id)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    if (download) {
      const { handle } = await openRegularFileNoFollow(resolved);
      const stream = Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>;
      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": "attachment; filename=\"bash-output.log\"",
          "Cache-Control": "no-store",
        },
      });
    }

    const result = await readUtf8FileWithinLimit(resolved);
    if (result.tooLarge) {
      return NextResponse.json({
        error: `Full output is too large to display (limit ${MAX_INLINE_BASH_OUTPUT_BYTES} bytes)`,
        data: { size: result.size, maxBytes: MAX_INLINE_BASH_OUTPUT_BYTES },
      }, { status: 413 });
    }
    return NextResponse.json({ success: true, data: { output: result.content } }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "full output unavailable" }, { status: 404 });
  }
}
