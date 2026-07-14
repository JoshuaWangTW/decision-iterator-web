# 決策迭代器 — 網頁版

Next.js 16 應用程式。瀏覽器裡的決策大腦：`/` 列表頁、`/s/[id]` 聊天頁、`/d/[id]/dashboard.html` 看板頁（可獨立分享）。

---

## 30 秒啟動（本機）

**前提：Node.js 18+ 已安裝**

```powershell
cd D:\aiproject\decision-iterator-web
npm install

# 複製環境變數範本
Copy-Item .env.local.example .env.local
```

接著選擇啟動模式：

### 模式 A：零成本試玩（mock 大腦，驗流程）

```powershell
# 編輯 .env.local，確認以下兩行：
# LLM=mock
# STORAGE=fs
# （不需要填 ANTHROPIC_API_KEY）

npm run dev
```

打開 [http://localhost:3000](http://localhost:3000)，建立 session、對話、確認看板更新。Mock 大腦會回覆固定繁中文字並更新狀態，完整走完 tool-use 迴圈。

### 模式 B：真大腦（Anthropic API）

```powershell
# 編輯 .env.local：
# ANTHROPIC_API_KEY=sk-ant-...
# LLM=real
# STORAGE=fs
# MODEL=claude-sonnet-4-6    ← 可改成 claude-opus-4-8

npm run dev
```

取得金鑰：[https://console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)

> **成本提醒**：真模型按 token 計費。System prompt 與工具定義已啟用 prompt caching（`cache_control: ephemeral`），跨請求重複部分可節省約 80-90% 輸入成本。帳單查詢：[https://console.anthropic.com/settings/billing](https://console.anthropic.com/settings/billing)

---

## 路由說明

| URL | 說明 |
|-----|------|
| `/` | Session 列表 + 新建表單（可刪除） |
| `/s/[id]` | 聊天頁（串流，client component；重整後回填對話歷史） |
| `/d/[id]/dashboard.html` | 看板頁（靜態 HTML，可獨立分享或 iframe 嵌入） |
| `/d/[id]/session-state.json` | 狀態 JSON（看板每 2 秒輪詢，no-store） |

API：`GET/POST /api/sessions`、`GET/DELETE /api/s/[id]`、`POST /api/s/[id]/message`（串流）。

看板 URL 可直接複製給他人瀏覽，不需登入。

---

## 對話歷史

每輪對話存在 session state 的 `chatLog` 欄位，並在下一輪以真正的 user/assistant 輪次送進模型 context（預設帶最近 20 輪）。這是多輪推演的前提——少了它，模型每輪都只看得到狀態 JSON，答不出「我剛剛說了什麼」。

`chatLog` 是**伺服器端擁有**的欄位：模型透過 `update_session_state` 寫回的是整份狀態、不含 `chatLog`，由 `src/lib/orchestrate.ts` 補回，避免歷史被覆蓋。網頁與 LINE 共用同一份歷史。

---

## 模型切換

在 `.env.local` 設定：

```
MODEL=claude-sonnet-4-6   # 預設，速度快、成本低
MODEL=claude-opus-4-8     # 更深入推理，成本較高
```

也可在聊天頁 POST body 帶 `model` 欄位動態切換（API 層支援）。

---

## 本機資料存放位置

`STORAGE=fs` 時，session 資料存在專案根目錄下：

```
D:\aiproject\decision-iterator-web\.data\sessions\<session-id>\
  session-state.json    ← 完整狀態（原子寫入）
```

---

## 部署：Supabase + Vercel

### 1. 建立 Supabase 專案

1. 前往 [https://supabase.com](https://supabase.com) 建立新專案
2. 進入 SQL Editor，貼上並執行 `supabase/migration.sql`（建立 `sessions` 表）
3. 取得以下兩個值（Project Settings → API）：
   - **Project URL**：`https://xxxx.supabase.co`
   - **service_role key**（不是 anon key）

> **RLS 提醒**：`migration.sql` 的 RLS 預設未啟用（單人使用）。若部署後要加帳號系統，依照檔案末尾的 RLS 範本啟用後才上線。

### 2. 安裝 Supabase 套件

```powershell
npm install @supabase/supabase-js
```

> `@supabase/supabase-js` 在 `package.json` 中為 `optionalDependencies`，本機 `STORAGE=fs` 時不需安裝。切換到 Supabase 前需手動安裝。

### 3. 設定環境變數並部署到 Vercel

```powershell
# 登入 Vercel CLI（如未安裝：npm install -g vercel）
vercel login

# 設定環境變數（在 Vercel 上）
vercel env add ANTHROPIC_API_KEY
vercel env add LLM              # 填 real
vercel env add STORAGE          # 填 supabase
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY

# 部署
vercel --prod
```

或在 Vercel Dashboard（[https://vercel.com/dashboard](https://vercel.com/dashboard)）的 Project → Settings → Environment Variables 逐一填入後，從 GitHub 推送觸發自動部署。

> `SUPABASE_SERVICE_ROLE_KEY` 是服務端金鑰，絕對不要用 `NEXT_PUBLIC_` 前綴暴露到前端。

### 4. 驗證

部署後打開 Vercel 提供的 URL，建立一個 session 並對話，確認：
- 聊天可串流回應
- `/d/[id]/dashboard.html` 有內容
- Supabase 控制台的 `sessions` 表有新增資料

---

## .env.local 完整範本

```
ANTHROPIC_API_KEY=sk-ant-...
LLM=mock
STORAGE=fs
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

（即 `.env.local.example` 的內容）

---

## 技術規格

- Framework：Next.js 16 + React 19（App Router）
- 語言：TypeScript strict
- 樣式：Tailwind CSS 4
- LLM：Anthropic SDK（`@anthropic-ai/sdk`）
- 儲存：fs adapter（本機）或 Supabase adapter（生產）
- 串流：`ReadableStream` + `getReader()`（NodeJS runtime，不走 edge）
