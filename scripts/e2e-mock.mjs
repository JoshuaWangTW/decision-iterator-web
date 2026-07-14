#!/usr/bin/env node
// E2E mock verification script — runs against local dev server with LLM=mock STORAGE=fs
// Usage: node scripts/e2e-mock.mjs
// The dev server must already be running (started externally with the correct env vars).
// This script:
//   a) POST create session via API
//   b) POST /api/s/<id>/message and reads full stream
//   c) Assert state file updated: timeline has entry, frame.decision non-empty
//   d) GET /d/<id>/session-state.json → 200 JSON
//   e) GET /d/<id>/dashboard.html → 200 with EMBEDDED_STATE

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://localhost:3000";
const DATA_DIR = join(process.cwd(), ".data", "sessions");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

async function readStream(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

// --- a) Create session ---
console.log("\n--- a) Create session ---");
const createRes = await fetch(`${BASE}/api/sessions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: "我要不要開第二家店", lens: "business" }),
});

let sessionId;
if (createRes.ok) {
  const json = await createRes.json();
  sessionId = json.id;
  console.log("Created session via API:", sessionId);
} else {
  // API route not present — create via fs directly using library
  // Fall back: find any existing session or fail
  console.log("POST /api/sessions not found, trying to create via direct import...");
  // We can't import TS directly; use the home page's server action instead
  // For the E2E test, use the session creation route we know exists
  console.log("Note: /api/sessions route not implemented. Checking for existing sessions...");

  // Check if any sessions exist already
  if (existsSync(DATA_DIR)) {
    const dirs = (await import("node:fs")).readdirSync(DATA_DIR);
    if (dirs.length > 0) {
      sessionId = dirs[0];
      console.log("Using existing session:", sessionId);
    }
  }
  if (!sessionId) {
    console.error("No session found. Start dev server, visit http://localhost:3000, create a session first.");
    process.exit(1);
  }
}

// Verify session state file exists
const stateFile = join(DATA_DIR, sessionId, "session-state.json");
assert(existsSync(stateFile), `session-state.json exists at ${stateFile}`);

// --- b) POST message and read stream ---
console.log("\n--- b) POST message, read stream ---");
const msgRes = await fetch(`${BASE}/api/s/${sessionId}/message`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: "我要不要開第二家店" }),
});

assert(msgRes.ok, `POST /api/s/${sessionId}/message status ${msgRes.status}`);
assert(msgRes.headers.get("content-type")?.startsWith("text/plain"), "content-type is text/plain");

const streamText = await readStream(msgRes);
console.log("Stream output (first 200 chars):", streamText.slice(0, 200));
assert(streamText.includes("現在只要做一件事"), `stream contains "現在只要做一件事"`);

// --- c) Assert state updated ---
console.log("\n--- c) Assert state file updated ---");
const updatedState = JSON.parse(readFileSync(stateFile, "utf8"));
assert(Array.isArray(updatedState.timeline), "state.timeline is array");
assert(updatedState.timeline.length > 1, `state.timeline has >1 entry (got ${updatedState.timeline.length})`);
assert(updatedState.frame?.decision !== undefined, "state.frame.decision exists");
assert(updatedState.frame.decision.length > 0, `state.frame.decision non-empty: "${updatedState.frame.decision}"`);

// --- d) GET /d/<id>/session-state.json ---
console.log("\n--- d) GET /d/<id>/session-state.json ---");
const jsonRes = await fetch(`${BASE}/d/${sessionId}/session-state.json`);
assert(jsonRes.ok, `/d/${sessionId}/session-state.json status ${jsonRes.status}`);
const jsonBody = await jsonRes.json();
assert(jsonBody.schemaVersion === "1.0", `schemaVersion is "1.0"`);

// --- e) GET /d/<id>/dashboard.html ---
console.log("\n--- e) GET /d/<id>/dashboard.html ---");
const htmlRes = await fetch(`${BASE}/d/${sessionId}/dashboard.html`);
assert(htmlRes.ok, `/d/${sessionId}/dashboard.html status ${htmlRes.status}`);
const htmlBody = await htmlRes.text();
assert(htmlBody.includes("EMBEDDED_STATE") || htmlBody.includes(sessionId), "dashboard.html contains state data");
assert(htmlBody.includes("<!DOCTYPE html>"), "dashboard.html is valid HTML");

// --- f) 對話歷史:第二輪後 chatLog 應累積成 4 筆,順序正確 ---
console.log("\n--- f) Chat history persists across turns ---");
const SECOND = "等等，我想到現金流才是重點";
const msgRes2 = await fetch(`${BASE}/api/s/${sessionId}/message`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: SECOND }),
});
assert(msgRes2.ok, `second POST message status ${msgRes2.status}`);
await readStream(msgRes2);

const histRes = await fetch(`${BASE}/api/s/${sessionId}`);
assert(histRes.ok, `GET /api/s/${sessionId} status ${histRes.status}`);
const hist = await histRes.json();
const log = hist.messages;
assert(Array.isArray(log), "history payload has messages array");
assert(log.length === 4, `chatLog has 4 entries after 2 turns (got ${log.length})`);
assert(
  log.map((m) => m.role).join(",") === "user,assistant,user,assistant",
  "chatLog roles alternate user/assistant"
);
assert(log[2].text === SECOND, "second user turn stored verbatim");
assert(log[1].text.length > 0 && log[3].text.length > 0, "assistant replies stored");

// chatLog 必須活過模型的 update_session_state 寫回(伺服器端擁有的欄位)
const stateAfter = JSON.parse(readFileSync(stateFile, "utf8"));
assert(
  Array.isArray(stateAfter.chatLog) && stateAfter.chatLog.length === 4,
  "chatLog survives the model's full-state tool write"
);

// --- g) 刪除 session ---
console.log("\n--- g) Delete session ---");
const delRes = await fetch(`${BASE}/api/s/${sessionId}`, { method: "DELETE" });
assert(delRes.status === 204, `DELETE /api/s/${sessionId} returns 204 (got ${delRes.status})`);
assert(!existsSync(stateFile), "session state file removed from disk");
const goneRes = await fetch(`${BASE}/api/s/${sessionId}`);
assert(goneRes.status === 404, `GET deleted session returns 404 (got ${goneRes.status})`);
const listRes = await fetch(`${BASE}/api/sessions`);
const list = await listRes.json();
assert(!list.some((s) => s.id === sessionId), "deleted session gone from list");

console.log("\n--- All assertions passed ---\n");
