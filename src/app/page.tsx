"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/status-badge";

type DocumentRow = {
  id: string;
  fileName: string;
  sizeBytes: number;
  status: "uploaded" | "processing" | "ready" | "failed";
  error: string | null;
  pageCount: number | null;
  createdAt: string;
};

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.bmp,.tif,.tiff,.heif,.docx,.xlsx,.pptx,.html";

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    () =>
      fetch("/api/documents").then(async (res) => {
        if (res.ok) setDocs(await res.json());
        else setError("Could not load documents. Is the database running?");
      }),
    [],
  );

  useEffect(() => {
    const timer = setTimeout(load);
    return () => clearTimeout(timer);
  }, [load]);

  // Poll while anything is still being analyzed.
  const pending = docs?.some((d) => d.status === "uploaded" || d.status === "processing");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [pending, load]);

  async function upload(files: FileList | File[]) {
    if (!files.length) return;
    setUploading(true);
    setError(null);
    const form = new FormData();
    for (const f of Array.from(files)) form.append("files", f);
    const res = await fetch("/api/documents", { method: "POST", body: form });
    if (!res.ok) setError((await res.json()).error ?? "Upload failed");
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    load();
  }

  async function reprocess(id: string) {
    await fetch(`/api/documents/${id}/reprocess`, { method: "POST" });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Upload files to extract text, tables and key-value pairs with Azure AI Document Intelligence.
        </p>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
          dragging
            ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
            : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => e.target.files && upload(e.target.files)}
        />
        <span className="font-medium">{uploading ? "Uploading…" : "Drop files here or click to browse"}</span>
        <span className="mt-1 text-xs text-zinc-500">PDF, images (JPG/PNG/TIFF/BMP/HEIF), DOCX, XLSX, PPTX, HTML</span>
      </label>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">{error}</p>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Pages</th>
              <th className="px-4 py-2 font-medium">Size</th>
              <th className="px-4 py-2 font-medium">Uploaded</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {docs === null && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-zinc-500">Loading…</td></tr>
            )}
            {docs?.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-zinc-500">No documents yet.</td></tr>
            )}
            {docs?.map((d) => (
              <tr key={d.id} className="border-t border-zinc-200 dark:border-zinc-800">
                <td className="px-4 py-2">
                  <Link href={`/documents/${d.id}`} className="font-medium hover:underline">{d.fileName}</Link>
                  {d.error && <div className="mt-0.5 text-xs text-red-600 dark:text-red-400">{d.error}</div>}
                </td>
                <td className="px-4 py-2"><StatusBadge status={d.status} /></td>
                <td className="px-4 py-2">{d.pageCount ?? "—"}</td>
                <td className="px-4 py-2">{(d.sizeBytes / 1024).toFixed(0)} KB</td>
                <td className="px-4 py-2">{new Date(d.createdAt).toLocaleString()}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {(d.status === "ready" || d.status === "failed") && (
                    <button onClick={() => reprocess(d.id)} className="mr-3 text-zinc-600 hover:underline dark:text-zinc-400">
                      Reprocess
                    </button>
                  )}
                  <button onClick={() => remove(d.id)} className="text-red-600 hover:underline dark:text-red-400">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
