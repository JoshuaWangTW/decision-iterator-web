// LLM runner selector — driven by LLM env var (mock | real)
import type { LLMRunner } from "./types";

export type { LLMRunner };

let _runner: LLMRunner | null = null;

export function getLLM(): LLMRunner {
  if (_runner) return _runner;

  const mode = process.env.LLM ?? "real";
  if (mode === "mock") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mockRunner } = require("./mock");
    _runner = mockRunner as LLMRunner;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { anthropicRunner } = require("./anthropic");
    _runner = anthropicRunner as LLMRunner;
  }
  return _runner!;
}
