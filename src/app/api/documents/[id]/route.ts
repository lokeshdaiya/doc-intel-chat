import { rm } from "node:fs/promises";
import { asc, eq } from "drizzle-orm";
import { connection } from "next/server";
import { db, documentFields, documents, documentTables } from "@/db";

export async function GET(_request: Request, ctx: RouteContext<"/api/documents/[id]">) {
  await connection();
  const { id } = await ctx.params;

  const [doc] = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      mimeType: documents.mimeType,
      sizeBytes: documents.sizeBytes,
      status: documents.status,
      error: documents.error,
      modelId: documents.modelId,
      pageCount: documents.pageCount,
      content: documents.content,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(eq(documents.id, id));
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });

  const [tables, fields] = await Promise.all([
    db.select().from(documentTables).where(eq(documentTables.documentId, id)).orderBy(asc(documentTables.tableIndex)),
    db.select().from(documentFields).where(eq(documentFields.documentId, id)).orderBy(asc(documentFields.id)),
  ]);

  return Response.json({ ...doc, tables, fields });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  const [doc] = await db.delete(documents).where(eq(documents.id, id)).returning();
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });
  await rm(doc.storagePath, { force: true });
  return new Response(null, { status: 204 });
}
