// Filesystem StorageAdapter — development/verification use
// Sessions stored at ./.data/sessions/<id>/session-state.json
// Atomic write via tmp file + rename to avoid partial reads.
import fs from "node:fs";
import path from "node:path";
import type { StorageAdapter } from "./types";
import type { SessionListItem, SessionState, Lens } from "../schema";
import { createSessionState } from "../session";

const DATA_DIR = path.join(process.cwd(), ".data", "sessions");

// session id 白名單：中日文字、數字、連字號,1-64 字。擋路徑穿越
// (含 Windows 的 %5C→\ 向量);read/write 都必須先過這關。
const ID_RE = /^[\p{L}\p{N}-]{1,64}$/u;
function assertSafeId(id: string): void {
  if (!ID_RE.test(id)) throw new Error("不合法的 session id");
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function sessionDir(id: string): string {
  assertSafeId(id);
  return path.join(DATA_DIR, id);
}

function statePath(id: string): string {
  return path.join(sessionDir(id), "session-state.json");
}

function readStateFile(id: string): SessionState | null {
  const p = statePath(id);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as SessionState;
  } catch {
    return null;
  }
}

function writeAtomic(filePath: string, content: string): void {
  const tmp = filePath + ".tmp." + process.pid;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

export const fsAdapter: StorageAdapter = {
  async list(): Promise<SessionListItem[]> {
    if (!fs.existsSync(DATA_DIR)) return [];
    const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
    const items: SessionListItem[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const state = readStateFile(e.name);
      if (!state) continue;
      items.push({
        id: state.session.id,
        title: state.session.title,
        updatedAt: state.session.updatedAt,
      });
    }
    // Most recently updated first
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return items;
  },

  async create({ title, lens }): Promise<{ id: string }> {
    const state = createSessionState(title, lens as Lens);
    const dir = sessionDir(state.session.id);
    ensureDir(dir);
    writeAtomic(statePath(state.session.id), JSON.stringify(state, null, 2));
    return { id: state.session.id };
  },

  async read(id: string): Promise<SessionState | null> {
    return readStateFile(id);
  },

  async write(id: string, state: SessionState): Promise<void> {
    const dir = sessionDir(id);
    ensureDir(dir);
    writeAtomic(statePath(id), JSON.stringify(state, null, 2));
  },

  async delete(id: string): Promise<void> {
    // sessionDir 已驗 id;force 讓不存在的路徑不拋錯
    fs.rmSync(sessionDir(id), { recursive: true, force: true });
  },
};
