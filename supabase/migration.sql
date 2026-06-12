-- decision-iterator-web: sessions table
-- Run this once in your Supabase SQL editor (or via CLI: supabase db push)

create table if not exists sessions (
  id           text        primary key,
  title        text        not null,
  lens         text        not null default 'business',
  state        jsonb       not null,
  updated_at   timestamptz not null default now()
);

-- Index for listing sessions ordered by updated_at
create index if not exists sessions_updated_at_idx on sessions (updated_at desc);

-- Row Level Security (RLS) — not enabled for MVP (single-user, no auth)
-- To enable when adding auth:
--   alter table sessions enable row level security;
--   create policy "Users own their sessions"
--     on sessions for all
--     using (auth.uid()::text = state->>'owner_uid')
--     with check (auth.uid()::text = state->>'owner_uid');
