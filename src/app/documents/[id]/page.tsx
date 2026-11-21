"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ChatPanel } from "@/components/chat-panel";
import { Markdown } from "@/components/markdown";
import { StatusBadge } from "@/components/status-badge";

type DocumentDetail = {
  id: string;
  fileName: string;
  status: string;
  error: string | null;
  modelId: string | null;
  pageCount: number | null;
  content: string | null;
  tables: { id: number; tableIndex: number; pageNumber: number | null; rows: string[][] }[];
  fields: { id: number; key: string; value: string | null; confidence: number | null; pageNumber: number | null }[];
};

const TABS = ["content", "tables", "fields", "chat"] as const;
type Tab = (typeof TABS)[number];

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>("content");

  const load = useCallback(
    () =>
      fetch(`/api/documents/${id}`).then(async (res) => {
        if (res.status === 404) setNotFound(true);
        else if (res.ok) setDoc(await res.json());
      }),
    [id],
  );

  useEffect(() => {
    const timer = setTimeout(load);
    return () => clearTimeout(timer);
  }, [load]);

  const pending = doc?.status === "uploaded" || doc?.status === "processing";
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [pending, load]);

  if (notFound) return <p>Document not found. <Link href="/" className="underline">Back</Link></p>;
  if (!doc) return <p className="text-zinc-500">Loading…</p>;

  const counts: Record<Tab, number | null> = {
    content: null,
    tables: doc.tables.length,
    fields: doc.fields.length,
    chat: null,
  };

  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:underline">← Documents</Link>
        <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
          {doc.fileName} <StatusBadge status={doc.status} />
        </h1>
        <p className="text-sm text-zinc-500">
          {doc.pageCount ? `${doc.pageCount} pages · ` : ""}
          {doc.modelId ? `model ${doc.modelId}` : "not analyzed yet"}
        </p>
        {doc.error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{doc.error}</p>}
      </div>

      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm capitalize ${
              tab === t ? "border-blue-600 font-medium" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {t === "fields" ? "Key-value pairs" : t}
            {counts[t] !== null && <span className="ml-1 text-xs text-zinc-400">({counts[t]})</span>}
          </button>
        ))}
      </div>

      {tab === "content" &&
        (doc.content ? (
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <Markdown>{doc.content.replace(/<!--[\s\S]*?-->/g, "")}</Markdown>
          </div>
        ) : (
          <p className="text-zinc-500">{pending ? "Analyzing document…" : "No content extracted."}</p>
        ))}

      {tab === "tables" && (
        <div className="space-y-6">
          {doc.tables.length === 0 && <p className="text-zinc-500">No tables found.</p>}
          {doc.tables.map((t) => (
            <div key={t.id}>
              <h2 className="mb-2 text-sm font-medium text-zinc-500">
                Table {t.tableIndex + 1}{t.pageNumber ? ` · page ${t.pageNumber}` : ""}
              </h2>
              <div className="overflow-x-auto">
                <table className="border-collapse text-sm">
                  <tbody>
                    {t.rows.map((row, r) => (
                      <tr key={r} className={r === 0 ? "bg-zinc-100 font-medium dark:bg-zinc-800" : ""}>
                        {row.map((cell, c) => (
                          <td key={c} className="border border-zinc-300 px-2 py-1 align-top dark:border-zinc-700">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "fields" && (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">Key</th>
                <th className="px-4 py-2 font-medium">Value</th>
                <th className="px-4 py-2 font-medium">Confidence</th>
                <th className="px-4 py-2 font-medium">Page</th>
              </tr>
            </thead>
            <tbody>
              {doc.fields.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-zinc-500">No key-value pairs found.</td></tr>
              )}
              {doc.fields.map((f) => (
                <tr key={f.id} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="px-4 py-2 font-medium">{f.key}</td>
                  <td className="px-4 py-2">{f.value ?? "—"}</td>
                  <td className="px-4 py-2">{f.confidence != null ? `${Math.round(f.confidence * 100)}%` : "—"}</td>
                  <td className="px-4 py-2">{f.pageNumber ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "chat" && <ChatPanel documentId={doc.id} />}
    </div>
  );
}
