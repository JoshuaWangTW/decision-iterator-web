// POST /api/s/[id]/message — orchestrator: read state → LLM tool-use loop → write → stream reply
// Per ADR B-B: runtime=nodejs, force-dynamic, no-store, X-Accel-Buffering:no
// cache_control: tools (last) + system array (ADR B-B cache_control section)
import { getStorage } from "@/lib/storage";
import { getLLM } from "@/lib/llm";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import { lintAndFill, normalizeScores } from "@/lib/render";
import type { SessionState } from "@/lib/schema";
import type { ContentBlock, ToolUseBlock } from "@/lib/llm/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MODEL = "claude-sonnet-4-6";

// Tool definition with cache_control on the last (only) tool — per ADR caching spec
const TOOLS = [
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
const SYSTEM_BLOCKS = [
  {
    type: "text" as const,
    text: SYSTEM_PROMPT,
    cache_control: { type: "ephemeral" as const },
  },
];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const body = (await req.json()) as { text?: string; model?: string };
  const userText = body.text ?? "";
  const model = body.model ?? DEFAULT_MODEL;

  const storage = getStorage();
  const llm = getLLM();

  // Load existing state to inject into first user message context
  const existingState = await storage.read(id);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function enc(chunk: string) {
        controller.enqueue(encoder.encode(chunk));
      }

      try {
        // Build initial messages.
        // State is injected as a prior user/assistant exchange so both real and mock
        // models see it as established context, separate from the user's actual question.
        const messages: Array<{
          role: "user" | "assistant";
          content: string | ContentBlock[];
        }> = [];

        if (existingState) {
          messages.push({
            role: "user",
            content: `<session_state>\n${JSON.stringify(existingState, null, 2)}\n</session_state>`,
          });
          messages.push({
            role: "assistant",
            content: "已載入 session 狀態，繼續推進。",
          });
        }

        messages.push({
          role: "user",
          content: userText,
        });

        let loop = 0;
        const MAX_LOOPS = 6;

        while (loop < MAX_LOOPS) {
          loop++;

          const result = await llm.streamTurn({
            model,
            systemBlocks: SYSTEM_BLOCKS,
            tools: TOOLS,
            messages,
            onText: enc,
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
                await storage.write(id, rawState as unknown as SessionState);
              }
              toolResults.push({
                type: "tool_result" as const,
                // Anthropic API 要求 tool_use_id（非 id）；放在 role:user 訊息的 content
                tool_use_id: tu.id,
                content: "狀態已更新並重繪看板。",
              });
            }
          }

          // tool_result goes in role:user content (Anthropic API requirement)
          messages.push({ role: "user", content: toolResults });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        enc(`\n\n[錯誤: ${msg}]`);
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
