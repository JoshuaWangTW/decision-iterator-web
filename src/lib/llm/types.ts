import type { SessionState } from "../schema";

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolResultBlock {
  type: "tool_result";
  /** Anthropic API 要求的欄位名（不是 id）；對應 tool_use 的 id */
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface TurnResult {
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | string;
  content: ContentBlock[];
}

export interface StreamTurnParams {
  model: string;
  /** system prompt as an array with cache_control (for Anthropic caching) */
  systemBlocks: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  /** tools definition with cache_control on last entry */
  tools: Array<Record<string, unknown>>;
  messages: Array<{ role: "user" | "assistant"; content: string | ContentBlock[] }>;
  /** Called for each streamed text chunk */
  onText: (chunk: string) => void;
}

export interface LLMRunner {
  streamTurn(params: StreamTurnParams): Promise<TurnResult>;
}
