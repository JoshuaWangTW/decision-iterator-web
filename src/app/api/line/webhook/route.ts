// POST /api/line/webhook — LINE Messaging API webhook 入口
// 依 ADR 部分二:runtime nodejs、驗簽→401(在 LLM 前)、冪等早退、runOrchestration、reply
import { createHmac, timingSafeEqual } from "node:crypto";
import { getStorage } from "@/lib/storage";
import { createSessionState } from "@/lib/session";
import { runOrchestration } from "@/lib/orchestrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// LINE 文字訊息事件型別(最小型別定義,只宣告我們需要的欄位)
interface LineTextMessageEvent {
  type: "message";
  replyToken: string;
  source: {
    userId: string;
  };
  message: {
    type: "text";
    text: string;
  };
  deliveryContext?: {
    isRedelivery?: boolean;
  };
}

interface LineWebhookBody {
  events: LineTextMessageEvent[];
}

/**
 * 驗簽 — HMAC-SHA256(channel_secret, raw_body_utf8) → base64
 * 比對用 timingSafeEqual 防時序側信道;長度不等直接失敗(防配對攻擊)。
 */
function verifySignature(secret: string, rawBody: string, signature: string): boolean {
  const hmac = createHmac("sha256", secret);
  hmac.update(rawBody, "utf8");
  const computed = Buffer.from(hmac.digest("base64"));
  const provided = Buffer.from(signature);
  // 以 byte 長度先檢(timingSafeEqual 要求等長;比字串 length 更穩,
  // 避免高位元組 header 讓 timingSafeEqual 直接 throw 成 500)
  if (computed.length !== provided.length) return false;
  return timingSafeEqual(computed, provided);
}

/**
 * 呼叫 LINE Reply API
 * 失敗只記 server log,不影響 webhook 回應碼。
 */
async function replyToLine(
  replyToken: string,
  text: string,
  sessionId: string
): Promise<void> {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) {
    console.error("[line webhook] 缺 LINE_CHANNEL_ACCESS_TOKEN,無法回覆");
    return;
  }
  const baseUrl = process.env.PUBLIC_BASE_URL ?? "";
  const dashboardUrl = `${baseUrl}/d/${sessionId}/dashboard.html`;
  // 截 4500 字 + 看板連結
  const truncated = text.length > 4500 ? text.slice(0, 4500) + "…" : text;
  const replyText = `${truncated}\n\n📋 看板：${dashboardUrl}`;

  try {
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: "text", text: replyText }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[line webhook] LINE reply 失敗 ${res.status}: ${body}`);
    }
  } catch (err) {
    console.error("[line webhook] LINE reply 例外:", err);
  }
}

export async function POST(req: Request): Promise<Response> {
  // P0 控制流 1: 必須先讀取 raw body(驗簽需原始字串)
  const rawBody = await req.text();

  // P0 控制流 2: 取驗簽 header
  const signature = req.headers.get("x-line-signature") ?? "";

  // P0 控制流 3: 缺 secret 拒絕(不可無密鑰跳過驗簽)
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (!channelSecret) {
    console.error("[line webhook] 缺 LINE_CHANNEL_SECRET,拒絕請求");
    return new Response("missing channel secret", { status: 500 });
  }

  // P0 控制流 3: 驗簽失敗 → 401(在 LLM 之前!防額度燒毀)
  if (!verifySignature(channelSecret, rawBody, signature)) {
    return new Response("invalid signature", { status: 401 });
  }

  // P0 控制流 4: 解析 JSON
  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  // P0 控制流 5: 驗簽通過的空 events 也回 200(LINE Verify 需要)
  if (!body.events || body.events.length === 0) {
    return new Response("ok", { status: 200 });
  }

  const storage = getStorage();

  // P0 控制流 6: 逐一處理文字訊息事件
  for (const event of body.events) {
    // 只處理文字訊息
    if (event.type !== "message" || event.message?.type !== "text") continue;

    // 冪等護欄:重送早退,防重複燒 LLM 額度
    if (event.deliveryContext?.isRedelivery) {
      console.log(`[line webhook] isRedelivery=true, 跳過 ${event.source.userId}`);
      continue;
    }

    const userId = event.source.userId;
    // 群組/聊天室訊息可能無 userId;缺則跳過,避免 sessionId 變 "line-undefined"
    // 造成跨使用者狀態互混
    if (!userId) continue;
    const userText = event.message.text;
    // sessionId = "line-" + userId(英數 userId 符合白名單 ^[\p{L}\p{N}-]{1,64}$)
    const sessionId = `line-${userId}`;
    const replyToken = event.replyToken;

    try {
      // Ensure session 存在 — 選項 A:createSessionState + storage.write(upsert)
      const existing = await storage.read(sessionId);
      if (!existing) {
        const newState = createSessionState(
          userText.slice(0, 40),
          "business",
          sessionId
        );
        await storage.write(sessionId, newState);
      }

      // 執行編排
      const finalText = await runOrchestration({
        id: sessionId,
        userText,
      });

      // Reply — 失敗只記 log,不影響 webhook 200 回應
      await replyToLine(replyToken, finalText, sessionId);
    } catch (err) {
      // 錯誤不外洩;詳情記 server log
      console.error(`[line webhook] 處理事件失敗 userId=${userId}:`, err);
    }
  }

  return new Response("ok", { status: 200 });
}
