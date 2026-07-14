// 共用編排函式 — 與輸出格式無關,供 message/route.ts(串流)與 line/webhook/route.ts(同步)共用
// 抽自 src/app/api/s/[id]/message/route.ts 的 while 迴圈;行為完全等價。
import { getStorage } from "@/lib/storage";
import { getLLM } from "@/lib/llm";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import { lintAndFill, normalizeScores } from "@/lib/render";
import type { SessionState, ChatMessage } from "@/lib/schema";
import type { ContentBlock, ToolUseBlock } from "@/lib/llm/types";

// 預設模型可由 env 覆寫;呼叫端也可傳入 model 參數。
const DEFAULT_MODEL = process.env.MODEL || "claude-sonnet-4-6";

// 白名單:呼叫端(前端 POST body)傳來的 model 不可直通 Anthropic API。
export const ALLOWED_MODELS = ["claude-sonnet-4-6", "claude-opus-4-8"] as const;

// 帶進 context 的歷史訊息上限(20 輪對話)。超過只截尾,狀態 JSON 仍保有完整脈絡。
const MAX_CHAT_CONTEXT = 40;

// Tool definition with cache_control on the last (only) tool — per ADR caching spec
export const TOOLS = [
  {
    name: "update_session_state",
    description:
      "把這一輪推進後的**完整** session 狀態寫回。必須是符合 schema 1.0 的整份 state，不是差異。每次都要：更新 session.updatedAt 為現在 ISO8601、對有意義的變更 append 一筆 timeline。score 可留 0，渲染端會重算。",
    input_schema: {
      type: "object",
      properties: {
        state: {
          type: "object",
          description: "整份 session-state 物件（schemaVersion 1.0）",
        },
      },
      required: ["state"],
      // Intentionally lenient — handler does lintAndFill, not schema rejection
    },
    // cache_control on the last tool per ADR B-B
    cache_control: { type: "ephemeral" },
  },
];

// system as array with cache_control — per ADR B-B
export const SYSTEM_BLOCKS = [
  {
    type: "text" as const,
    text: SYSTEM_PROMPT,
    cache_control: { type: "ephemeral" as const },
  },
];

export interface OrchestrationParams {
  /** session id (已通過 SAFE_ID 驗證) */
  id: string;
  /** 使用者輸入文字 */
  userText: string;
  /** LLM 模型名稱;省略時用 DEFAULT_MODEL */
  model?: string;
  /** 每個 text chunk 回呼(用於串流);省略時靜默收集 */
  onText?: (chunk: string) => void;
}

/**
 * 執行單輪編排迴圈:讀 state → LLM tool-use loop → 寫 state → 回最終文字。
 * 行為與原 message/route.ts 的 while 迴圈完全等價。
 */
export async function runOrchestration({
  id,
  userText,
  model,
  onText,
}: OrchestrationParams): Promise<string> {
  const storage = getStorage();
  const llm = getLLM();
  const resolvedModel =
    model && (ALLOWED_MODELS as readonly string[]).includes(model)
      ? model
      : DEFAULT_MODEL;

  // 讀取既有 state 注入 context
  const existingState = await storage.read(id);
  const priorChat = existingState?.chatLog ?? [];

  // Build initial messages.
  // State is injected as a prior user/assistant exchange so both real and mock
  // models see it as established context, separate from the user's actual question.
  const messages: Array<{
    role: "user" | "assistant";
    content: string | ContentBlock[];
  }> = [];

  if (existingState) {
    // 狀態 JSON 不含 chatLog:對話歷史下面會以真正的 user/assistant 輪次帶入,
    // 重複塞進 JSON 只會浪費 token。
    const stateForPrompt: Partial<SessionState> = { ...existingState };
    delete stateForPrompt.chatLog;
    messages.push({
      role: "user",
      content: `<session_state>\n${JSON.stringify(stateForPrompt, null, 2)}\n</session_state>`,
    });
    messages.push({
      role: "assistant",
      content: "已載入 session 狀態，繼續推進。",
    });
  }

  // 對話歷史 — 沒有這段，模型每輪都是失憶的，只能從狀態 JSON 反推脈絡。
  for (const m of priorChat.slice(-MAX_CHAT_CONTEXT)) {
    messages.push({ role: m.role, content: m.text });
  }

  messages.push({
    role: "user",
    content: userText,
  });

  // 收集最終文字(onText 未提供時做為緩衝)
  let finalText = "";
  const collect = (chunk: string) => {
    finalText += chunk;
    onText?.(chunk);
  };

  // 模型寫回的最新狀態;沒呼叫工具時退回既有狀態。
  let latestState: SessionState | null = existingState;

  let loop = 0;
  const MAX_LOOPS = 6;

  while (loop < MAX_LOOPS) {
    loop++;

    const result = await llm.streamTurn({
      model: resolvedModel,
      systemBlocks: SYSTEM_BLOCKS,
      tools: TOOLS,
      messages,
      onText: collect,
    });

    // Push assistant turn into messages
    messages.push({ role: "assistant", content: result.content });

    // Check for tool_use
    const toolUses = result.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use"
    );

    if (result.stop_reason !== "tool_use" || toolUses.length === 0) {
      break;
    }

    // Process tool calls
    const toolResults: ContentBlock[] = [];
    for (const tu of toolUses) {
      if (tu.name === "update_session_state") {
        const rawState = (tu.input as { state?: unknown }).state as Record<string, unknown> | undefined;
        if (rawState) {
          lintAndFill(rawState);
          if (!rawState.session) rawState.session = {};
          (rawState.session as Record<string, unknown>).updatedAt = new Date().toISOString();
          normalizeScores(rawState as unknown as SessionState);
          // chatLog 是伺服器端擁有的欄位:模型的回傳不含它,直接寫入會把歷史抹掉。
          const next = rawState as unknown as SessionState;
          next.chatLog = priorChat;
          await storage.write(id, next);
          latestState = next;
        }
        toolResults.push({
          type: "tool_result" as const,
          // Anthropic API 要求 tool_use_id（非 id）；對應 tool_use 的 id
          tool_use_id: tu.id,
          content: "狀態已更新並重繪看板。",
        });
      }
    }

    // tool_result goes in role:user content (Anthropic API requirement)
    messages.push({ role: "user", content: toolResults });
  }

  // 收尾:把這一輪的 user/assistant 追加進 chatLog 並持久化。
  // 沒有這步，聊天頁重整就失憶、模型下一輪也看不到這輪講了什麼。
  if (latestState) {
    const ts = new Date().toISOString();
    const turn: ChatMessage[] = [{ ts, role: "user", text: userText }];
    if (finalText) turn.push({ ts, role: "assistant", text: finalText });
    latestState.chatLog = [...priorChat, ...turn];
    await storage.write(id, latestState);
  }

  return finalText;
}
