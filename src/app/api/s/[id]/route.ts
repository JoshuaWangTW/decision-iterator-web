// GET    /api/s/[id] — 取回對話歷史(聊天頁重整後回填)
// DELETE /api/s/[id] — 刪除 session
import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 與 message/route.ts 同一道白名單:路徑遍歷不進儲存層。
const SAFE_ID = /^[\p{L}\p{N}-]{1,64}$/u;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  if (!SAFE_ID.test(id)) {
    return NextResponse.json({ error: "invalid session id" }, { status: 400 });
  }
  const state = await getStorage().read(id);
  if (!state) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json(
    { title: state.session.title, messages: state.chatLog ?? [] },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  if (!SAFE_ID.test(id)) {
    return NextResponse.json({ error: "invalid session id" }, { status: 400 });
  }
  await getStorage().delete(id);
  return new NextResponse(null, { status: 204 });
}
