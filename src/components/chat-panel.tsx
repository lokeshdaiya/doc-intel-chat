"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "./markdown";

type Message = { role: "user" | "assistant"; content: string; sources?: Source[] };
type Source = { id: number; documentId: string; fileName: string; pageNumber: number | null };
type ProviderInfo = {
  id: string;
  label: string;
  note: string;
  configured: boolean;
  defaultModel: string;
  suggestedModels: string[];
};

export function ChatPanel({ documentId }: { documentId?: string }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((data: { defaultProvider: string | null; providers: ProviderInfo[] }) => {
        setProviders(data.providers);
        const initial = data.providers.find((p) => p.id === data.defaultProvider);
        if (initial) {
          setProvider(initial.id);
          setModel(initial.defaultModel);
        }
      });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const current = providers.find((p) => p.id === provider);
  const configured = providers.filter((p) => p.configured);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const history: Message[] = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
          documentId,
          provider: provider || undefined,
          model: model || undefined,
        }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error);
      }

      const sourcesHeader = res.headers.get("X-Chat-Sources");
      const sources: Source[] = sourcesHeader ? JSON.parse(decodeURIComponent(sourcesHeader)) : [];

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setMessages([...history, { role: "assistant", content: answer, sources }]);
      }
      if (!answer) {
        setMessages([...history, { role: "assistant", content: "⚠️ The model returned no text. Check the server logs." }]);
      }
    } catch (err) {
      setMessages([...history, { role: "assistant", content: `⚠️ ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-12rem)] min-h-[420px] flex-col rounded-xl border border-zinc-200 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
        <label className="text-zinc-500">Provider</label>
        <select
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setModel(providers.find((p) => p.id === e.target.value)?.defaultModel ?? "");
          }}
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
        >
          {configured.length === 0 && <option value="">No provider configured</option>}
          {configured.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <label className="ml-2 text-zinc-500">Model</label>
        <input
          list="model-suggestions"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 font-mono text-xs dark:border-zinc-700"
        />
        <datalist id="model-suggestions">
          {current?.suggestedModels.map((m) => <option key={m} value={m} />)}
        </datalist>
        {messages.length > 0 && (
          <button onClick={() => setMessages([])} className="text-zinc-500 hover:underline">Clear</button>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-center text-sm text-zinc-500">
            {documentId ? "Ask anything about this document." : "Ask a question across all your processed documents."}
            {current && <span className="mt-1 block text-xs">{current.note}</span>}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[80%] rounded-2xl bg-blue-600 px-4 py-2 text-white"
                  : "max-w-full rounded-2xl bg-zinc-100 px-4 py-2 dark:bg-zinc-900"
              }
            >
              {m.role === "user" ? (
                <p className="whitespace-pre-wrap">{m.content}</p>
              ) : m.content ? (
                <Markdown>{m.content}</Markdown>
              ) : (
                <span className="text-zinc-500">Thinking…</span>
              )}
              {m.sources && m.sources.length > 0 && m.content && (
                <div className="mt-2 flex flex-wrap gap-1 border-t border-zinc-200 pt-2 text-xs text-zinc-500 dark:border-zinc-800">
                  {m.sources.map((s) => (
                    <a key={s.id} href={`/documents/${s.documentId}`} className="rounded bg-zinc-200 px-1.5 py-0.5 hover:underline dark:bg-zinc-800">
                      [{s.id}] {s.fileName}{s.pageNumber ? ` p.${s.pageNumber}` : ""}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} className="flex gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          className="flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
        />
        <button
          type="submit"
          disabled={busy || !input.trim() || !provider}
          className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {busy ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
