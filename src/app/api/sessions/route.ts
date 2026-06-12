// POST /api/sessions — create a new session, return { id }
// GET  /api/sessions — list sessions
import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const storage = getStorage();
  const sessions = await storage.list();
  return NextResponse.json(sessions);
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as { title?: string; lens?: string };
  const title = body.title?.trim() ?? "";
  const lens = body.lens ?? "business";

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const storage = getStorage();
  const { id } = await storage.create({ title, lens });
  return NextResponse.json({ id }, { status: 201 });
}
