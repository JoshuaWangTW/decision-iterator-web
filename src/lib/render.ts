// Render pipeline — ported from skill repo render.mjs
// Injects session state into the vendored dashboard template.
import fs from "node:fs";
import path from "node:path";
import type { SessionState } from "./schema";

const TEMPLATE_PATH = path.join(process.cwd(), "src", "assets", "dashboard-template.html");

/** Recompute priority scores in place (impact * likelihood / cost). Returns state. */
export function normalizeScores(state: SessionState): SessionState {
  for (const n of state.nodes ?? []) {
    if (n.priority) {
      const { impact, likelihood, cost } = n.priority;
      n.priority.score = cost
        ? parseFloat(((Number(impact) * Number(likelihood)) / Number(cost)).toFixed(2))
        : 0;
    }
  }
  return state;
}

/** Lint top-level fields; returns warning strings (never throws). */
export function lintAndFill(state: Record<string, unknown>): void {
  const required = [
    "schemaVersion",
    "session",
    "lens",
    "phase",
    "frame",
    "nodes",
    "insights",
    "decision",
    "timeline",
    "redFlags",
  ] as const;
  for (const k of required) {
    if (!(k in state)) {
      (state as Record<string, unknown>)[k] = k === "nodes" || k === "insights" || k === "timeline" || k === "redFlags" ? [] : {};
    }
  }
  // Ensure updatedAt is always set
  const sess = state.session as Record<string, unknown> | undefined;
  if (sess && !sess.updatedAt) {
    sess.updatedAt = new Date().toISOString();
  }
}

/**
 * 把 state 安全序列化成可內嵌進 <script> 的 JSON 字面值。
 * JSON.stringify 不跳脫 < > 與行分隔符,直接內嵌會被 HTML 解析階段提早
 * 關閉 script(`</script>` 破出 → 儲存型 XSS,在可分享連結場景跨使用者執行)。
 * 用 \u 跳脫 <、>、U+2028、U+2029 後仍是合法 JS 字串,樣板照常 parse。
 */
export function safeStateScriptJson(state: SessionState): string {
  // 替換目標為字面文字(源碼用雙反斜線),否則會被 JS 解析成字元本身使 replace 失效。
  return JSON.stringify(state, null, 2)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Inject state into the vendored template and return the HTML string.
 * Asserts __STATE__ appears exactly once (per render.mjs defensive check).
 */
export function renderDashboard(state: SessionState): string {
  const tpl = fs.readFileSync(TEMPLATE_PATH, "utf8");
  const hits = (tpl.match(/__STATE__/g) ?? []).length;
  if (hits !== 1) {
    throw new Error(
      `模板的占位符 __STATE__ 應恰好出現 1 次，實際 ${hits} 次。請檢查 src/assets/dashboard-template.html。`
    );
  }
  const json = safeStateScriptJson(state);
  // 用函式形式替換:避免 JSON 內的 $& / $$ 等被當成 replace 的特殊樣式
  return tpl.replaceAll("__STATE__", () => json);
}
