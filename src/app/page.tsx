"use client";
// / — Session list + new session(mobile-first)
// 改用 client component + /api/sessions(POST 建立 / GET 列表),
// 取代 server action <form action={fn}> —— 後者在 Next.js 16 + Turbopack dev
// 下會回非預期回應("An unexpected response was received from the server")。
// API route 路徑與 mock E2E 驗證的一致,穩定可用。
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface SessionListItem {
  id: string;
  title: string;
  updatedAt: string;
}

export default function HomePage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [title, setTitle] = useState("");
  const [lens, setLens] = useState("business");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // 載入既有 session 列表
  useEffect(() => {
    let cancelled = false;
    fetch("/api/sessions")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: SessionListItem[]) => {
        if (!cancelled) setSessions(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const createSession = useCallback(async () => {
    const t = title.trim();
    if (!t || creating) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t, lens }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { id } = (await res.json()) as { id: string };
      router.push(`/s/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立失敗，請再試一次。");
      setCreating(false);
    }
  }, [title, lens, creating, router]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      createSession();
    }
  }

  return (
    <main className="flex-1 mx-auto w-full max-w-lg px-4 py-8 flex flex-col gap-6">
      {/* Header */}
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--accent)" }}>
          決策迭代器
        </h1>
        <p className="text-sm" style={{ color: "var(--txt-dim)" }}>
          商業・職涯決策的沉穩軍師
        </p>
      </header>

      {/* New session */}
      <section
        className="rounded-xl p-4 flex flex-col gap-3 border"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
      >
        <h2 className="text-sm font-medium" style={{ color: "var(--txt-dim)" }}>
          開新決策
        </h2>
        <div className="flex flex-col gap-3">
          <input
            name="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="我的決策是…"
            disabled={creating}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none border transition-colors"
            style={{
              background: "var(--panel-2)",
              borderColor: "var(--border)",
              color: "var(--txt)",
            }}
          />
          <div className="flex gap-2 items-center">
            <select
              name="lens"
              value={lens}
              onChange={(e) => setLens(e.target.value)}
              disabled={creating}
              className="rounded-lg px-3 py-2 text-sm flex-1 border outline-none"
              style={{
                background: "var(--panel-2)",
                borderColor: "var(--border)",
                color: "var(--txt)",
              }}
            >
              <option value="business">商業鏡頭</option>
              <option value="career">職涯鏡頭</option>
              <option value="hybrid">混合鏡頭</option>
            </select>
            <button
              type="button"
              onClick={createSession}
              disabled={creating || !title.trim()}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: "var(--accent)", color: "var(--bg)" }}
            >
              {creating ? "建立中…" : "開始"}
            </button>
          </div>
          {error && (
            <p className="text-xs" style={{ color: "var(--refuted)" }}>
              {error}
            </p>
          )}
        </div>
      </section>

      {/* Session list */}
      {sessions.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium" style={{ color: "var(--txt-dim)" }}>
            進行中的決策
          </h2>
          <ul className="flex flex-col gap-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/s/${s.id}`}
                  className="flex flex-col gap-0.5 rounded-xl p-4 border transition-opacity hover:opacity-80"
                  style={{ background: "var(--panel)", borderColor: "var(--border)" }}
                >
                  <span className="text-sm font-medium truncate">{s.title}</span>
                  <span className="text-xs" style={{ color: "var(--txt-dim)" }}>
                    {new Date(s.updatedAt).toLocaleString("zh-TW", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sessions.length === 0 && (
        <p className="text-sm text-center py-8" style={{ color: "var(--txt-dim)" }}>
          還沒有決策。填上你的問題，我們開始。
        </p>
      )}
    </main>
  );
}
