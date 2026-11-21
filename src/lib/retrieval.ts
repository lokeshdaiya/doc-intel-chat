import { and, asc, eq, sql } from "drizzle-orm";
import { db, documentChunks, documents } from "@/db";

export type RetrievedChunk = {
  id: number;
  documentId: string;
  fileName: string;
  pageNumber: number | null;
  content: string;
};

const MAX_CHUNKS = 8;

/**
 * Finds the chunks most relevant to the question using Postgres full-text search.
 * Terms are OR-ed so natural-language questions still match; results are ranked
 * by ts_rank_cd. Falls back to the opening chunks when nothing matches (e.g.
 * "summarize this document").
 */
export async function retrieveChunks(question: string, documentId?: string): Promise<RetrievedChunk[]> {
  const terms = question
    .toLowerCase()
    .match(/[\p{L}\p{N}]{2,}/gu)
    ?.slice(0, 30) ?? [];

  const scope = and(
    eq(documents.status, "ready"),
    documentId ? eq(documentChunks.documentId, documentId) : undefined,
  );

  const columns = {
    id: documentChunks.id,
    documentId: documentChunks.documentId,
    fileName: documents.fileName,
    pageNumber: documentChunks.pageNumber,
    content: documentChunks.content,
  };

  if (terms.length) {
    // to_tsquery would choke on raw user text, so build "a | b | c" from sanitized words.
    const query = sql`to_tsquery('english', ${terms.join(" | ")})`;
    const ranked = await db
      .select(columns)
      .from(documentChunks)
      .innerJoin(documents, eq(documents.id, documentChunks.documentId))
      .where(and(scope, sql`${documentChunks.searchVector} @@ ${query}`))
      .orderBy(sql`ts_rank_cd(${documentChunks.searchVector}, ${query}) desc`)
      .limit(MAX_CHUNKS);
    if (ranked.length) return ranked;
  }

  return db
    .select(columns)
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .where(scope)
    .orderBy(asc(documentChunks.documentId), asc(documentChunks.chunkIndex))
    .limit(MAX_CHUNKS);
}
