// Anthropic SDK LLM runner — real API calls with streaming + tool-use + prompt caching
// Per ADR B-B: messages.stream + cache_control on tools (last) and system array.
// Model default: claude-sonnet-4-6; optional: claude-opus-4-8
import Anthropic from "@anthropic-ai/sdk";
import type { LLMRunner, StreamTurnParams, TurnResult, ContentBlock } from "./types";

function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Set it in .env.local or as an environment variable."
    );
  }
  return new Anthropic({ apiKey: key });
}

export const anthropicRunner: LLMRunner = {
  async streamTurn(params: StreamTurnParams): Promise<TurnResult> {
    const { model, systemBlocks, tools, messages, onText } = params;
    const client = getClient();

    // messages.stream returns a stream helper
    const stream = await client.messages.stream({
      model,
      max_tokens: 4096,
      system: systemBlocks as Anthropic.TextBlockParam[],
      tools: tools as unknown as Anthropic.Tool[],
      messages: messages as Anthropic.MessageParam[],
    });

    // Stream text deltas as they arrive
    stream.on("text", (text: string) => {
      onText(text);
    });

    // Wait for the full message
    const msg = await stream.finalMessage();

    // Map SDK content blocks to our ContentBlock type
    const content: ContentBlock[] = msg.content.map((block) => {
      if (block.type === "text") {
        return { type: "text" as const, text: block.text };
      }
      if (block.type === "tool_use") {
        return {
          type: "tool_use" as const,
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
      }
      // Fallback for unexpected block types
      return { type: "text" as const, text: "" };
    });

    return {
      stop_reason: msg.stop_reason ?? "end_turn",
      content,
    };
  },
};
