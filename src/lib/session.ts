// Session factory — ported from skill repo new-session.mjs
import type { SessionState, Lens } from "./schema";

/** Convert a title string to a kebab-case slug (preserves CJK characters) */
export function slugify(s: string): string {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "session";
}

/** Create a fresh session-state skeleton matching schemaVersion 1.0 */
export function createSessionState(
  title: string,
  lens: Lens = "business",
  customId?: string
): SessionState {
  const now = new Date().toISOString();
  const date = now.slice(0, 10);
  const id = customId ?? `${date}-${slugify(title)}`;

  return {
    schemaVersion: "1.0",
    session: { id, title, createdAt: now, updatedAt: now },
    lens,
    phase: "frame",
    frame: { rawAsk: title, decision: "", owner: "", stakes: "", successCriteria: "" },
    nodes: [],
    insights: [],
    decision: { options: [], chosen: "", nextSteps: [] },
    timeline: [{ ts: now, type: "phase-change", detail: "建立 session，進入 FRAME 階段" }],
    redFlags: [],
    chatLog: [],
  };
}
