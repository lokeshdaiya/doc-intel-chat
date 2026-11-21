import { eq } from "drizzle-orm";
import { after } from "next/server";
import { db, documents } from "@/db";
import { processDocument } from "@/lib/process-document";

export const maxDuration = 300;

export async function POST(_request: Request, ctx: RouteContext<"/api/documents/[id]/reprocess">) {
  const { id } = await ctx.params;
  const [doc] = await db
    .update(documents)
    .set({ status: "uploaded", error: null, updatedAt: new Date() })
    .where(eq(documents.id, id))
    .returning({ id: documents.id });
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });

  after(() => processDocument(id));
  return Response.json({ id, status: "uploaded" }, { status: 202 });
}
