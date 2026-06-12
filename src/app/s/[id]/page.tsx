"use client";
// /s/[id] — Chat page (client component, streaming, mobile-first, fixed bottom input)
import { useState, useRef, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface Message {
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
}

const MODELS = [
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-opus-4-8", label: "Opus 4.8" },
];

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(MODELS[0].value);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  const dashboardUrl = `/d/${id}/dashboard.html`;

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setLoading(true);

    // Add user message
    setMessages((prev) => [...prev, { role: "user", text }]);

    // Add streaming assistant placeholder
    setMessages((prev) => [
      ...prev,
      { role: "assistant", text: "", streaming: true },
    ]);

    try {
      const res = await fetch(`/api/s/${id}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, model }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunk = buffer;
        buffer = "";
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            copy[copy.length - 1] = { ...last, text: last.text + chunk };
          }
          return copy;
        });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") {
          copy[copy.length - 1] = {
            ...last,
            text: last.text || `[錯誤: ${errMsg}]`,
            streaming: false,
          };
        }
        return copy;
      });
    } finally {
      // Mark streaming done
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant" && last.streaming) {
          copy[copy.length - 1] = { ...last, streaming: false };
        }
        return copy;
      });
      setLoading(false);
      textareaRef.current?.focus();
    }
  }, [id, input, loading, model]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="flex flex-col h-dvh" style={{ background: "var(--bg)" }}>
      {/* Top bar */}
      <header
        className="flex items-center justify-between gap-2 px-4 py-3 border-b shrink-0"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href="/"
            className="text-sm shrink-0 transition-opacity hover:opacity-70"
            style={{ color: "var(--txt-dim)" }}
          >
            ←
          </Link>
          <span className="text-sm font-medium truncate" style={{ color: "var(--accent)" }}>
            決策迭代器
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="text-xs rounded-md px-2 py-1 border outline-none"
            style={{
              background: "var(--panel-2)",
              borderColor: "var(--border)",
              color: "var(--txt-dim)",
            }}
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <a
            href={dashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-2 py-1 rounded-md border transition-opacity hover:opacity-70"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
          >
            看板 ↗
          </a>
        </div>
      </header>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <div
            className="text-center text-sm py-12 leading-relaxed"
            style={{ color: "var(--txt-dim)" }}
          >
            輸入你的決策問題，沉穩軍師開始陪你推演。
            <br />
            <span className="text-xs">Shift+Enter 換行，Enter 送出</span>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === "user" ? "rounded-tr-sm" : "rounded-tl-sm"
              }`}
              style={{
                background: m.role === "user" ? "var(--panel-2)" : "var(--panel)",
                color: "var(--txt)",
              }}
            >
              {m.text}
              {m.streaming && (
                <span
                  className="inline-block w-1 h-4 ml-0.5 align-middle animate-pulse rounded-sm"
                  style={{ background: "var(--accent)" }}
                />
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Fixed bottom input */}
      <div
        className="shrink-0 px-4 py-3 border-t"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
      >
        <div className="flex gap-2 items-end max-w-lg mx-auto">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="輸入你的決策問題…"
            rows={1}
            disabled={loading}
            className="flex-1 resize-none rounded-xl px-3 py-2.5 text-sm outline-none border transition-colors min-h-[44px]"
            style={{
              background: "var(--panel-2)",
              borderColor: "var(--border)",
              color: "var(--txt)",
              lineHeight: "1.5",
            }}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="rounded-xl px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-40 shrink-0 min-h-[44px]"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
          >
            {loading ? "…" : "送出"}
          </button>
        </div>
      </div>
    </div>
  );
}
