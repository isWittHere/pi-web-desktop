import { NextRequest, NextResponse } from "next/server";
import { listThemeSets } from "@/lib/theme";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cwd = searchParams.get("cwd") || undefined;

    const themeSets = listThemeSets(cwd);

    return NextResponse.json({ themeSets });
  } catch (error) {
    console.error("Failed to list themes:", error);
    return NextResponse.json(
      { error: "Failed to list themes" },
      { status: 500 },
    );
  }
}
