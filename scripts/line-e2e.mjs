#!/usr/bin/env node
// LINE webhook mock E2E — 依 ADR 2.8 規格
// 使用場景: LLM=mock STORAGE=fs LINE_CHANNEL_SECRET=test-secret-123 npm run dev
// 然後在另一個 terminal: node scripts/line-e2e.mjs
//
// 斷言:
//   (1) 合法簽章 → 200 且 fs 有寫入 line-U... session
//   (2) 篡改一位元 → 401 且無寫入、無 LLM 呼叫
//   (3) 缺 x-line-signature → 401

import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://localhost:3000";
const SECRET = "test-secret-123";
const DATA_DIR = join(process.cwd(), ".data", "sessions");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

/** 用 HMAC-SHA256 簽原始 body */
function sign(secret, rawBody) {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
}

/** 建構合法 LINE text message event body */
function buildBody(userId, text) {
  return JSON.stringify({
    events: [
      {
        type: "message",
        replyToken: "test-reply-token-" + Date.now(),
        source: { userId },
        message: { type: "text", text },
        deliveryContext: { isRedelivery: false },
      },
    ],
  });
}

/** POST 到 webhook */
async function callWebhook(rawBody, signature) {
  const headers = { "Content-Type": "application/json" };
  if (signature !== undefined) {
    headers["x-line-signature"] = signature;
  }
  return fetch(`${BASE}/api/line/webhook`, {
    method: "POST",
    headers,
    body: rawBody,
  });
}

const userId = "Utest12345678901234567890123456"; // 32 字元英數,合法 LINE userId 格式

// --- (1) 合法簽章 → 200 且 session 寫入 ---
console.log("\n--- (1) 合法簽章 ---");
const body1 = buildBody(userId, "我要不要開第二家店");
const sig1 = sign(SECRET, body1);
const res1 = await callWebhook(body1, sig1);
assert(res1.status === 200, `合法簽章回 200 (got ${res1.status})`);

// 等待 storage 寫入完成(編排為同步,200 回前已寫)
const sessionId = `line-${userId}`;
const stateFile = join(DATA_DIR, sessionId, "session-state.json");
assert(existsSync(stateFile), `fs 有寫入 session 檔案: ${stateFile}`);

console.log("session 檔案存在:", stateFile);

// --- (2) 篡改一位元 → 401 且無新寫入 ---
console.log("\n--- (2) 篡改簽章 ---");
const body2 = buildBody("Udifferent00000000000000000000001", "另一則訊息");
// 合法簽章的最後一個字元改掉(base64 字符集替換)
const sig2Valid = sign(SECRET, body2);
const lastChar = sig2Valid.slice(-1);
const flippedChar = lastChar === "A" ? "B" : "A";
const sig2Tampered = sig2Valid.slice(0, -1) + flippedChar;

const res2 = await callWebhook(body2, sig2Tampered);
assert(res2.status === 401, `篡改簽章回 401 (got ${res2.status})`);

// 確認無寫入(不同 userId 的 session 不應存在)
const sessionId2 = "line-Udifferent00000000000000000000001";
const stateFile2 = join(DATA_DIR, sessionId2, "session-state.json");
assert(!existsSync(stateFile2), "篡改簽章無寫入 session");

// --- (3) 缺 x-line-signature → 401 ---
console.log("\n--- (3) 缺 x-line-signature ---");
const body3 = buildBody("Unone000000000000000000000000001", "無簽章");
const res3 = await callWebhook(body3, undefined);
assert(res3.status === 401, `缺 x-line-signature 回 401 (got ${res3.status})`);

// 空 events 必須回 200(LINE Verify 需要)
console.log("\n--- (4) 空 events(LINE Verify)→ 200 ---");
const emptyBody = JSON.stringify({ events: [] });
const sigEmpty = sign(SECRET, emptyBody);
const resEmpty = await callWebhook(emptyBody, sigEmpty);
assert(resEmpty.status === 200, `空 events 回 200 (got ${resEmpty.status})`);

console.log("\n--- All LINE E2E assertions passed ---\n");
