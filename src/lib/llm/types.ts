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

export type ContentBlock = TextBlock | ToolUseBlock;

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
