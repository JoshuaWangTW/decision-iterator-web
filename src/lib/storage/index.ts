// Storage adapter selector — driven by STORAGE env var (fs | supabase)
// @supabase/supabase-js is an optional dependency (only needed when STORAGE=supabase).
import type { StorageAdapter } from "./types";
import { fsAdapter } from "./fs";

export type { StorageAdapter };

let _adapter: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (_adapter) return _adapter;

  const mode = process.env.STORAGE ?? "fs";
  if (mode === "supabase") {
    // supabaseAdapter uses @supabase/supabase-js (optional dep)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { supabaseAdapter } = require("./supabase") as { supabaseAdapter: StorageAdapter };
    _adapter = supabaseAdapter;
  } else {
    _adapter = fsAdapter;
  }
  return _adapter!;
}
