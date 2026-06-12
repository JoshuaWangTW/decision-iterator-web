// Storage adapter selector — driven by STORAGE env var (fs | supabase | pg)
// @supabase/supabase-js and pg are optional dependencies (only needed when STORAGE matches).
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
  } else if (mode === "pg") {
    // pgAdapter uses pg (optional dep) + DATABASE_URL
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pgAdapter } = require("./pg") as { pgAdapter: StorageAdapter };
    _adapter = pgAdapter;
  } else {
    _adapter = fsAdapter;
  }
  return _adapter!;
}
