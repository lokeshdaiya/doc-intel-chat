import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, documentChunks, documentFields, documents, documentTables } from "@/db";
import { extractors, isExtractorId } from "./extractors";
import type { ExtractionResult } from "./extractors/types";
import { resolveExtractionSettings } from "./settings";

const CHUNK_SIZE = 1500;

/** Runs the configured extractor on a stored upload and persists everything it extracts. */
export async function processDocument(documentId: string) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc) return;

  const { settings } = await resolveExtractionSettings();
  if (!isExtractorId(settings.extractor)) throw new Error(`Unknown extractor ${settings.extractor}`);
  const extractor = extractors[settings.extractor];

  await db
    .update(documents)
    .set({ status: "processing", error: null, extractor: extractor.id, updatedAt: new Date() })
    .where(eq(documents.id, documentId));

  try {
    const file = await readFile(doc.storagePath);
    const result = await extractor.extract({
      file,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      settings,
    });

    await db.transaction(async (tx) => {
      // Clear output from any previous run so reprocessing is idempotent.
      await tx.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
      await tx.delete(documentTables).where(eq(documentTables.documentId, documentId));
      await tx.delete(documentFields).where(eq(documentFields.documentId, documentId));

      const chunks = chunkContent(result);
      if (chunks.length) {
        await tx.insert(documentChunks).values(
          chunks.map((c, i) => ({ documentId, chunkIndex: i, ...c })),
        );
      }

      if (result.tables.length) {
        await tx.insert(documentTables).values(
          result.tables.map((t, tableIndex) => ({
            documentId,
            tableIndex,
            pageNumber: t.pageNumber,
            rowCount: t.rows.length,
            columnCount: Math.max(0, ...t.rows.map((r) => r.length)),
            rows: t.rows,
          })),
        );
      }

      if (result.fields.length) {
        await tx.insert(documentFields).values(result.fields.map((f) => ({ documentId, ...f })));
      }

      await tx
        .update(documents)
        .set({
          status: "ready",
          modelId: result.modelId,
          pageCount: result.pages.length || null,
          content: result.content,
          rawResult: result.raw ?? null,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));
    });
  } catch (err) {
    console.error(`Processing failed for document ${documentId} (${extractor.id})`, err);
    await db
      .update(documents)
      .set({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));
  }
}

/** Maps a character offset in `content` to the page it falls on. */
function pageForOffset(result: ExtractionResult, offset: number): number | null {
  let page: number | null = null;
  for (const p of result.pages) {
    if (p.offset <= offset) page = p.pageNumber;
  }
  return page;
}

/** Splits the Markdown content on paragraph boundaries into ~CHUNK_SIZE pieces. */
function chunkContent(result: ExtractionResult) {
  const content = result.content;
  const chunks: { content: string; pageNumber: number | null }[] = [];
  let start = 0;

  while (start < content.length) {
    let end = Math.min(start + CHUNK_SIZE, content.length);
    if (end < content.length) {
      const paragraphBreak = content.lastIndexOf("\n\n", end);
      if (paragraphBreak > start + CHUNK_SIZE / 2) end = paragraphBreak;
    }
    // Drop page markers (Azure emits them as HTML comments) so they don't pollute chat context.
    const text = content
      .slice(start, end)
      .replace(/<!--\s*Page(Break|Number|Header|Footer)[^>]*-->/g, "")
      .trim();
    if (text) chunks.push({ content: text, pageNumber: pageForOffset(result, start) });
    start = end;
  }
  return chunks;
}
