// Codex CLI LLM runner — 用本機 `codex exec` 吃 ChatGPT 訂閱 token(非 API 計費）。
//
// 前提:本機已安裝 codex CLI 且已登入(~/.codex/auth.json 存在,auth 為 chatgpt）。
// 因此僅適用「單機/本機」執行——部署到 Vercel 等無 codex/無登入的環境請改用 LLM=real（Anthropic）。
//
// 模型:預設用 codex 自身 config 的模型（你的「最強」預設,如 gpt-5.6-sol）;
//       設 CODEX_MODEL 可往下降(如 CODEX_MODEL=gpt-5.1）。
//
// 橋接:codex exec 沒有自訂 tool,改用 --output-schema 強制它吐出
//       { reply, state } 的 JSON。state 是「JSON 字串」(結構化輸出不允許任意物件,
//       故用字串包起來),由 orchestrate.ts 的 lintAndFill 收尾——與既有寬鬆 tool 契約一致。
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LLMRunner, StreamTurnParams, TurnResult } from "./types";

// reply(繁中回覆)+ state(整份 session-state 的 JSON 字串)。每個物件都要 additionalProperties:false。
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    state: { type: "string" },
  },
  required: ["reply", "state"],
  additionalProperties: false,
};

let _schemaPath: string | null = null;
function schemaFile(): string {
  if (_schemaPath) return _schemaPath;
  _schemaPath = join(tmpdir(), "decision-iterator-codex-schema.json");
  writeFileSync(_schemaPath, JSON.stringify(OUTPUT_SCHEMA));
  return _schemaPath;
}

/** 收到 tool_result 的第二段:狀態已在第一段寫回,不再耗一次 codex run,直接 end_turn。
 *  與 mock 相同的兩段式,讓 orchestrate.ts 的 tool-use 迴圈原封不動地寫入 state。 */
function isToolResultTurn(messages: StreamTurnParams["messages"]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") {
      return (
        Array.isArray(m.content) &&
        m.content.some((b) => (b as { type: string }).type === "tool_result")
      );
    }
  }
  return false;
}

function buildPrompt(params: StreamTurnParams): string {
  const system = params.systemBlocks.map((b) => b.text).join("\n\n");
  // 第一段的 messages 皆為字串(注入的 <session_state> / 對話歷史 / 使用者輸入);攤平成逐字稿。
  const transcript = params.messages
    .filter((m) => typeof m.content === "string")
    .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content as string}`)
    .join("\n\n");
  return [
    system,
    "---",
    "以下是對話脈絡。請依上述系統指令扮演決策迭代器的大腦,推進這個決策。",
    transcript,
    "---",
    "輸出規則(務必遵守):",
    "1. 不要執行任何 shell 指令、不要讀寫任何檔案,只需思考後回覆。",
    "2. 最終回覆必須符合指定的 JSON schema,含兩個欄位:",
    "   - reply:給使用者看的繁體中文回覆(等同你平常會直接說的話)。",
    "   - state:一個「JSON 字串」,內容是符合 schemaVersion 1.0 的**完整** session-state 物件" +
      "(等同你平常呼叫 update_session_state 工具時傳入的整份 state,不是差異)。" +
      "這一輪即使不改狀態,也要回傳與輸入相同的完整狀態。",
  ].join("\n\n");
}

function runCodex(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Windows 上 codex 是 codex.cmd,Node 安全性限制:spawn .cmd 必須走 shell。
    // 走 shell 時含空白的路徑要自己加引號(路徑外的 flag/值不需要)。
    const isWin = process.platform === "win32";
    const bin = isWin ? "codex.cmd" : "codex";
    const q = (s: string) => (isWin ? `"${s}"` : s);

    const args = [
      "exec",
      "--output-schema", q(schemaFile()),
      "-s", "read-only",
      "--skip-git-repo-check",
      "--ephemeral",
      "--color", "never",
      "-C", q(tmpdir()),
    ];
    // CODEX_MODEL 未設 → 不帶 -m,由 codex config 決定(最強預設）。設了則往下降。
    const model = process.env.CODEX_MODEL;
    if (model) args.push("-m", model);
    args.push("-"); // prompt 從 stdin 讀

    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], shell: isWin });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) =>
      reject(new Error(`codex 無法啟動(是否已安裝並登入 codex?):${e.message}`))
    );
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`codex exec 失敗(exit ${code}):${err.slice(-500)}`));
      } else {
        resolve(out);
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** codex 只印最終訊息(乾淨 JSON);仍容錯地抓最後一個 JSON 物件。 */
function extractJson(out: string): { reply: string; state: string } {
  const trimmed = out.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("codex 輸出無法解析為 JSON:" + trimmed.slice(0, 200));
  }
}

async function streamText(text: string, onText: (chunk: string) => void): Promise<void> {
  for (let i = 0; i < text.length; i += 12) {
    onText(text.slice(i, i + 12));
    await new Promise((r) => setTimeout(r, 0));
  }
}

export const codexRunner: LLMRunner = {
  async streamTurn(params: StreamTurnParams): Promise<TurnResult> {
    // 第二段:狀態已寫回,直接收尾(不重打 codex,省一次訂閱 token 開銷）。
    if (isToolResultTurn(params.messages)) {
      return { stop_reason: "end_turn", content: [{ type: "text", text: "" }] };
    }

    const raw = await runCodex(buildPrompt(params));
    const parsed = extractJson(raw);

    await streamText(parsed.reply, params.onText);

    let state: Record<string, unknown>;
    try {
      state = JSON.parse(parsed.state) as Record<string, unknown>;
    } catch {
      throw new Error("codex 回傳的 state 不是合法 JSON 字串");
    }

    return {
      stop_reason: "tool_use",
      content: [
        { type: "text", text: parsed.reply },
        {
          type: "tool_use",
          id: "codex-tool-call-1",
          name: "update_session_state",
          input: { state },
        },
      ],
    };
  },
};
