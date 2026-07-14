// PostgreSQL StorageAdapter — Zeabur production use
// Requires: DATABASE_URL in environment (= Zeabur POSTGRES_CONNECTION_STRING)
// Table schema: see supabase/migration.sql (vanilla Postgres DDL, no Supabase specifics)
// pg is an optionalDependency — loaded via require() so STORAGE=fs won't fail without it.
import type { StorageAdapter } from "./types";
import type { SessionListItem, SessionState, Lens } from "../schema";
import { createSessionState } from "../session";

// session id 白名單：中日文字、數字、連字號,1-64 字。縱深防禦,擋 SQL inject 殘餘向量。
const ID_RE = /^[\p{L}\p{N}-]{1,64}$/u;
function assertSafeId(id: string): void {
  if (!ID_RE.test(id)) throw new Error("不合法的 session id");
}

// 模組級單例 Pool — lazy 初始化,避免 STORAGE=fs 時載入 pg 驅動。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pool: any | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPool(): any {
  if (_pool) return _pool;
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    throw new Error(
      "STORAGE=pg requires DATABASE_URL env var (= Zeabur POSTGRES_CONNECTION_STRING)."
    );
  }
  // Dynamic require — pg is optional, only installed when STORAGE=pg
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg") as { Pool: new (opts: { connectionString: string }) => { on(ev: string, cb: (e: Error) => void): void } };
  const pool = new Pool({ connectionString: connStr });
  // 雲端 DB 會主動關閉閒置連線;若不掛 error handler,idle client 的 'error'
  // 會變成 unhandled 並讓整個 process crash。記 log 即可,pool 會自動建新連線。
  pool.on("error", (err: Error) => {
    console.error("[pg pool] idle client error:", err.message);
  });
  _pool = pool;
  return _pool;
}

export const pgAdapter: StorageAdapter = {
  async list(): Promise<SessionListItem[]> {
    const pool = getPool();
    // 全參數化:無動態 SQL 拼接
    const { rows } = await pool.query(
      "SELECT id, title, updated_at FROM sessions ORDER BY updated_at DESC"
    );
    return rows.map((r: { id: string; title: string; updated_at: string }) => ({
      id: r.id,
      title: r.title,
      updatedAt: r.updated_at,
    }));
  },

  async create({ title, lens }): Promise<{ id: string }> {
    // createSessionState 是唯一合法 id 來源,不可自造。
    const state = createSessionState(title, lens as Lens);
    const pool = getPool();
    // 全參數化 $1..$5,對齊 supabase.ts insert 欄位
    await pool.query(
      `INSERT INTO sessions (id, title, lens, state, updated_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        state.session.id,
        state.session.title,
        state.lens,
        JSON.stringify(state),
        state.session.updatedAt,
      ]
    );
    return { id: state.session.id };
  },

  async read(id: string): Promise<SessionState | null> {
    assertSafeId(id);
    const pool = getPool();
    // 全參數化 $1
    const { rows } = await pool.query(
      "SELECT state FROM sessions WHERE id = $1",
      [id]
    );
    if (rows.length === 0) return null;
    // jsonb 欄 pg driver 已自動 parse 成物件
    return (rows[0].state as SessionState) ?? null;
  },

  async write(id: string, state: SessionState): Promise<void> {
    assertSafeId(id);
    const pool = getPool();
    // UPSERT — 首次 insert,後續 update。全參數化 $1..$5
    await pool.query(
      `INSERT INTO sessions (id, title, lens, state, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
         SET title      = EXCLUDED.title,
             lens       = EXCLUDED.lens,
             state      = EXCLUDED.state,
             updated_at = EXCLUDED.updated_at`,
      [
        id,
        state.session.title,
        state.lens,
        JSON.stringify(state),
        state.session.updatedAt,
      ]
    );
  },

  async delete(id: string): Promise<void> {
    assertSafeId(id);
    const pool = getPool();
    await pool.query("DELETE FROM sessions WHERE id = $1", [id]);
  },
};
