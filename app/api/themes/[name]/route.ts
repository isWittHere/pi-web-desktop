import { NextRequest, NextResponse } from "next/server";
import { resolveTheme } from "@/lib/theme";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;
    const { searchParams } = new URL(request.url);
    const cwd = searchParams.get("cwd") || undefined;

    const resolved = resolveTheme(decodeURIComponent(name), cwd);

    if (!resolved) {
      return NextResponse.json(
        { error: `Theme "${name}" not found` },
        { status: 404 },
      );
    }

    return NextResponse.json(resolved);
  } catch (error) {
    console.error("Failed to resolve theme:", error);
    return NextResponse.json(
      { error: "Failed to resolve theme" },
      { status: 500 },
    );
  }
}
