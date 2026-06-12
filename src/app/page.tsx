"use server";
// / — Session list + new session (mobile-first, server component + server action)
import { redirect } from "next/navigation";
import { getStorage } from "@/lib/storage";
import type { SessionListItem } from "@/lib/schema";

async function createSession(formData: FormData): Promise<never> {
  "use server";
  const title = (formData.get("title") as string | null)?.trim() ?? "";
  const lens = (formData.get("lens") as string | null) ?? "business";
  if (!title) redirect("/");
  const storage = getStorage();
  const { id } = await storage.create({ title, lens });
  redirect(`/s/${id}`);
}

export default async function HomePage() {
  const storage = getStorage();
  const sessions: SessionListItem[] = await storage.list();

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

      {/* New session form */}
      <section
        className="rounded-xl p-4 flex flex-col gap-3 border"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
      >
        <h2 className="text-sm font-medium" style={{ color: "var(--txt-dim)" }}>
          開新決策
        </h2>
        <form action={createSession} className="flex flex-col gap-3">
          <input
            name="title"
            type="text"
            placeholder="我的決策是…"
            required
            className="w-full rounded-lg px-3 py-2 text-sm outline-none border focus:border-[--accent] transition-colors"
            style={{
              background: "var(--panel-2)",
              borderColor: "var(--border)",
              color: "var(--txt)",
            }}
          />
          <div className="flex gap-2 items-center">
            <select
              name="lens"
              defaultValue="business"
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
              type="submit"
              className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
              style={{ background: "var(--accent)", color: "var(--bg)" }}
            >
              開始
            </button>
          </div>
        </form>
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
                <a
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
                </a>
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
