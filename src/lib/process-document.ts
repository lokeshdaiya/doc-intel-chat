import { readFile } from "node:fs/promises";
import type { AnalyzeResultOutput } from "@azure-rest/ai-document-intelligence";
import { eq } from "drizzle-orm";
import { db, documentChunks, documentFields, documents, documentTables } from "@/db";
import { analyzeDocument, getModelId } from "./document-intelligence";

const CHUNK_SIZE = 1500;

/** Runs Document Intelligence on a stored upload and persists everything it extracts. */
export async function processDocument(documentId: string) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc) return;

  await db
    .update(documents)
    .set({ status: "processing", error: null, updatedAt: new Date() })
    .where(eq(documents.id, documentId));

  try {
    const file = await readFile(doc.storagePath);
    const result = await analyzeDocument(file);

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

      const tables = extractTables(result);
      if (tables.length) {
        await tx.insert(documentTables).values(tables.map((t) => ({ documentId, ...t })));
      }

      const fields = extractFields(result);
      if (fields.length) {
        await tx.insert(documentFields).values(fields.map((f) => ({ documentId, ...f })));
      }

      await tx
        .update(documents)
        .set({
          status: "ready",
          modelId: getModelId(),
          pageCount: result.pages?.length ?? null,
          content: result.content,
          rawResult: result,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));
    });
  } catch (err) {
    console.error(`Processing failed for document ${documentId}`, err);
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
function pageForOffset(result: AnalyzeResultOutput, offset: number): number | null {
  for (const page of result.pages ?? []) {
    for (const span of page.spans ?? []) {
      if (offset >= span.offset && offset < span.offset + span.length) return page.pageNumber;
    }
  }
  return null;
}

/** Splits the Markdown content on paragraph boundaries into ~CHUNK_SIZE pieces. */
function chunkContent(result: AnalyzeResultOutput) {
  const content = result.content ?? "";
  const chunks: { content: string; pageNumber: number | null }[] = [];
  let start = 0;

  while (start < content.length) {
    let end = Math.min(start + CHUNK_SIZE, content.length);
    if (end < content.length) {
      const paragraphBreak = content.lastIndexOf("\n\n", end);
      if (paragraphBreak > start + CHUNK_SIZE / 2) end = paragraphBreak;
    }
    // Drop Document Intelligence's page markers so they don't pollute chat context.
    const text = content
      .slice(start, end)
      .replace(/<!--\s*Page(Break|Number|Header|Footer)[^>]*-->/g, "")
      .trim();
    if (text) chunks.push({ content: text, pageNumber: pageForOffset(result, start) });
    start = end;
  }
  return chunks;
}

function extractTables(result: AnalyzeResultOutput) {
  return (result.tables ?? []).map((table, tableIndex) => {
    const rows = Array.from({ length: table.rowCount }, () =>
      Array<string>(table.columnCount).fill(""),
    );
    for (const cell of table.cells) {
      rows[cell.rowIndex][cell.columnIndex] = cell.content;
    }
    return {
      tableIndex,
      pageNumber: table.boundingRegions?.[0]?.pageNumber ?? null,
      rowCount: table.rowCount,
      columnCount: table.columnCount,
      rows,
    };
  });
}

/**
 * Collects key-value pairs from the layout model, plus typed fields when a
 * prebuilt model such as prebuilt-invoice or prebuilt-receipt is used.
 */
function extractFields(result: AnalyzeResultOutput) {
  const fields: { key: string; value: string | null; confidence: number | null; pageNumber: number | null }[] = [];

  for (const kv of result.keyValuePairs ?? []) {
    fields.push({
      key: kv.key.content,
      value: kv.value?.content ?? null,
      confidence: kv.confidence,
      pageNumber: kv.key.boundingRegions?.[0]?.pageNumber ?? null,
    });
  }

  for (const document of result.documents ?? []) {
    for (const [key, field] of Object.entries(document.fields ?? {})) {
      fields.push({
        key,
        value: field.content ?? null,
        confidence: field.confidence ?? null,
        pageNumber: field.boundingRegions?.[0]?.pageNumber ?? null,
      });
    }
  }
  return fields;
}
