// POST /api/s/[id]/message — 串流端點;編排邏輯已移至 src/lib/orchestrate.ts
// Per ADR B-B: runtime=nodejs, force-dynamic, no-store, X-Accel-Buffering:no
import { runOrchestration } from "@/lib/orchestrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 縱深防禦:即使 fs adapter 已集中驗 id,route 入口也擋一層,
// 路徑遍歷(../、%2f、%5c)直接回 400,不進入儲存層。
const SAFE_ID = /^[\p{L}\p{N}-]{1,64}$/u;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  if (!SAFE_ID.test(id)) {
    return new Response("invalid session id", { status: 400 });
  }
  const body = (await req.json()) as { text?: string; model?: string };
  const userText = body.text ?? "";
  const model = body.model;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function enc(chunk: string) {
        controller.enqueue(encoder.encode(chunk));
      }

      try {
        await runOrchestration({ id, userText, model, onText: enc });
      } catch (err) {
        // 不把內部錯誤(可能含檔案路徑等)原樣回前端;詳情記 server log
        console.error("[message route] 編排失敗:", err);
        enc(`\n\n[發生錯誤,請稍後再試。詳情見伺服器日誌。]`);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
