// Supabase StorageAdapter — production use
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in environment
// Table schema: see supabase/migration.sql
import type { StorageAdapter } from "./types";
import type { SessionListItem, SessionState, Lens } from "../schema";
import { createSessionState } from "../session";

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "STORAGE=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars."
    );
  }
  // Dynamic import so the package is optional when STORAGE=fs
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@supabase/supabase-js");
  return createClient(url, key);
}

export const supabaseAdapter: StorageAdapter = {
  async list(): Promise<SessionListItem[]> {
    const sb = getClient();
    const { data, error } = await sb
      .from("sessions")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(`Supabase list error: ${error.message}`);
    return (data ?? []).map(
      (r: { id: string; title: string; updated_at: string }) => ({
        id: r.id,
        title: r.title,
        updatedAt: r.updated_at,
      })
    );
  },

  async create({ title, lens }): Promise<{ id: string }> {
    const state = createSessionState(title, lens as Lens);
    const sb = getClient();
    const { error } = await sb.from("sessions").insert({
      id: state.session.id,
      title: state.session.title,
      lens: state.lens,
      state,
      updated_at: state.session.updatedAt,
    });
    if (error) throw new Error(`Supabase create error: ${error.message}`);
    return { id: state.session.id };
  },

  async read(id: string): Promise<SessionState | null> {
    const sb = getClient();
    const { data, error } = await sb
      .from("sessions")
      .select("state")
      .eq("id", id)
      .single();
    if (error) return null;
    return (data?.state as SessionState) ?? null;
  },

  async write(id: string, state: SessionState): Promise<void> {
    const sb = getClient();
    const { error } = await sb.from("sessions").upsert({
      id,
      title: state.session.title,
      lens: state.lens,
      state,
      updated_at: state.session.updatedAt,
    });
    if (error) throw new Error(`Supabase write error: ${error.message}`);
  },

  async delete(id: string): Promise<void> {
    const sb = getClient();
    const { error } = await sb.from("sessions").delete().eq("id", id);
    if (error) throw new Error(`Supabase delete error: ${error.message}`);
  },
};
