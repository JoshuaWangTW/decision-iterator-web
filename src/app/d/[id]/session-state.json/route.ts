// GET /d/[id]/session-state.json — return raw session state JSON
// This route is at the same URL level as dashboard.html so the template's
// 2-second polling fetch("./session-state.json") resolves correctly.
import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const storage = getStorage();
  const state = await storage.read(id);

  if (!state) {
    return new NextResponse(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new NextResponse(JSON.stringify(state, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
