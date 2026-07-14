import type { SessionListItem, SessionState } from "../schema";

export interface StorageAdapter {
  list(): Promise<SessionListItem[]>;
  create(params: { title: string; lens: string }): Promise<{ id: string }>;
  read(id: string): Promise<SessionState | null>;
  /** Full replacement — fs uses tmp+rename atomic write */
  write(id: string, state: SessionState): Promise<void>;
  /** Idempotent — 刪不存在的 id 不算錯 */
  delete(id: string): Promise<void>;
}
