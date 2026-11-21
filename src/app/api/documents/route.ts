import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { desc } from "drizzle-orm";
import { after, connection } from "next/server";
import { db, documents } from "@/db";
import { processDocument } from "@/lib/process-document";

export const maxDuration = 300;

// Formats accepted by Azure AI Document Intelligence (layout / read models).
const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".heif",
  ".docx", ".xlsx", ".pptx", ".html",
]);

const uploadDir = () => path.resolve(process.env.UPLOAD_DIR || "uploads");
const maxBytes = () => Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024;

export async function GET() {
  await connection();
  const rows = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      mimeType: documents.mimeType,
      sizeBytes: documents.sizeBytes,
      status: documents.status,
      error: documents.error,
      pageCount: documents.pageCount,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .orderBy(desc(documents.createdAt));
  return Response.json(rows);
}

export async function POST(request: Request) {
  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) {
    return Response.json({ error: "No files uploaded (expected form field 'files')." }, { status: 400 });
  }

  for (const file of files) {
    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return Response.json({ error: `${file.name}: unsupported file type ${ext || "(none)"}.` }, { status: 400 });
    }
    if (file.size > maxBytes()) {
      return Response.json(
        { error: `${file.name}: larger than ${process.env.MAX_UPLOAD_MB || 20} MB.` },
        { status: 400 },
      );
    }
  }

  await mkdir(uploadDir(), { recursive: true });

  const created: { id: string; fileName: string; status: string }[] = [];
  for (const file of files) {
    const id = crypto.randomUUID();
    const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
    const storagePath = path.join(uploadDir(), `${id}-${safeName}`);
    await writeFile(storagePath, Buffer.from(await file.arrayBuffer()));

    const [doc] = await db
      .insert(documents)
      .values({
        id,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        storagePath,
      })
      .returning({ id: documents.id, fileName: documents.fileName, status: documents.status });
    created.push(doc);
  }

  // Analyze after the response is sent so the upload returns immediately.
  after(async () => {
    for (const doc of created) await processDocument(doc.id);
  });

  return Response.json(created, { status: 201 });
}
