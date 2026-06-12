// GET /d/[id]/dashboard.html — inject session state into the dashboard template
// Same URL level as session-state.json so template's fetch("./session-state.json") hits the route.
import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { normalizeScores, renderDashboard, lintAndFill } from "@/lib/render";
import type { SessionState } from "@/lib/schema";

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
    return new NextResponse("Session not found", { status: 404 });
  }

  lintAndFill(state as unknown as Record<string, unknown>);
  normalizeScores(state as SessionState);
  const html = renderDashboard(state as SessionState);

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
