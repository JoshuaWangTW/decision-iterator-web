// Mock LLM runner — deterministic, no network, for E2E verification without an API key.
// Strictly implements the tool-use loop per ADR B-B mock spec:
//   First call (last user message is text): returns stop_reason:'tool_use' with update_session_state
//   Second call (last message contains tool_result): returns stop_reason:'end_turn'
import type { LLMRunner, StreamTurnParams, TurnResult, ContentBlock } from "./types";
import type { SessionState } from "../schema";

const MOCK_REPLY_FIRST = `好的，我來幫你框定這個決策。

根據你的問題，我需要先釐清決策的核心是什麼，並建立假設樹。

---
**現在只要做一件事:**
告訴我這個決策的背景——是什麼讓你現在想做這個決定？

你可以直接回我:
- 「主要是因為市場機會，我看到競爭對手開了第二家店」
- 「是財務壓力，第一家店的現金流不夠穩定」
- 「等等，我想到另一個問題比這個更重要」

💡 隨時可以打斷：說「等等，我想到...」或「先不管那個，看這個...」`;

const MOCK_REPLY_SECOND = `狀態已更新，看板正在同步。我們繼續推進。`;

/** Derive a minimal next state from the previous state and user text */
function deriveNextState(prev: SessionState | null, text: string): SessionState {
  const now = new Date().toISOString();
  const base: SessionState = prev ?? {
    schemaVersion: "1.0",
    session: { id: "mock-session", title: text, createdAt: now, updatedAt: now },
    lens: "business",
    phase: "frame",
    frame: { rawAsk: text, decision: "", owner: "", stakes: "", successCriteria: "" },
    nodes: [],
    insights: [],
    decision: { options: [], chosen: "", nextSteps: [] },
    timeline: [],
    redFlags: [],
  };

  const next: SessionState = JSON.parse(JSON.stringify(base)) as SessionState;
  next.session.updatedAt = now;

  // Fill frame.decision if empty
  if (!next.frame.decision) {
    next.frame.decision = text.slice(0, 60);
  }

  // Ensure at least one root node
  if (next.nodes.length === 0) {
    next.nodes.push({
      id: "n1",
      parent: null,
      label: text.slice(0, 30),
      lens: "business",
      type: "hypothesis",
      priority: { impact: 4, likelihood: 3, cost: 2, score: 0 },
      status: "open",
      evidence: [],
    });
  }

  // Append timeline note
  next.timeline.push({
    ts: now,
    type: "note",
    detail: "mock 推進：" + text.slice(0, 20),
  });

  return next;
}

/** Check if the last user-role message contains a tool_result */
function isToolResultTurn(
  messages: StreamTurnParams["messages"]
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") {
      if (Array.isArray(m.content)) {
        return m.content.some((b) => (b as { type: string }).type === "tool_result");
      }
      return false;
    }
  }
  return false;
}

/** Extract the last user text message, skipping session_state context injections */
function getLastUserText(messages: StreamTurnParams["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && typeof m.content === "string") {
      // Skip the injected <session_state> context message
      if (m.content.startsWith("<session_state>")) continue;
      // Skip tool_result content arrays
      return m.content;
    }
  }
  return "";
}

/** Extract the previous session state from:
 *  1. Prior assistant tool_use messages (update_session_state input)
 *  2. The injected <session_state> user message (first-turn context)
 */
function extractPrevState(messages: StreamTurnParams["messages"]): SessionState | null {
  // Prefer the most recent tool_use result (most up-to-date state)
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const b of m.content) {
        const block = b as { type: string; name?: string; input?: { state?: SessionState } };
        if (block.type === "tool_use" && block.name === "update_session_state" && block.input?.state) {
          return block.input.state;
        }
      }
    }
  }
  // Fall back to the injected <session_state> context message
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "user" && typeof m.content === "string") {
      const match = m.content.match(/<session_state>\s*([\s\S]*?)\s*<\/session_state>/);
      if (match) {
        try {
          return JSON.parse(match[1]) as SessionState;
        } catch {
          // ignore parse error
        }
      }
    }
  }
  return null;
}

async function streamText(text: string, onText: (chunk: string) => void): Promise<void> {
  // Emit in ~10-char chunks to simulate streaming
  for (let i = 0; i < text.length; i += 10) {
    onText(text.slice(i, i + 10));
    // Yield to event loop
    await new Promise((r) => setTimeout(r, 0));
  }
}

export const mockRunner: LLMRunner = {
  async streamTurn(params: StreamTurnParams): Promise<TurnResult> {
    const { messages, onText } = params;

    if (isToolResultTurn(messages)) {
      // Second call: tool_result received → end_turn
      await streamText(MOCK_REPLY_SECOND, onText);
      return {
        stop_reason: "end_turn",
        content: [{ type: "text", text: MOCK_REPLY_SECOND }],
      };
    }

    // First call: stream the reply text, then return tool_use
    await streamText(MOCK_REPLY_FIRST, onText);

    const userText = getLastUserText(messages);
    const prevState = extractPrevState(messages);
    const nextState = deriveNextState(prevState, userText);

    const toolUseBlock: ContentBlock = {
      type: "tool_use",
      id: "mock-tool-call-1",
      name: "update_session_state",
      input: { state: nextState },
    };

    return {
      stop_reason: "tool_use",
      content: [
        { type: "text", text: MOCK_REPLY_FIRST },
        toolUseBlock,
      ],
    };
  },
};
