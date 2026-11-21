import { streamText, type ModelMessage } from "ai";
import { z } from "zod";
import { defaultProviderId, isProviderId, providers } from "@/lib/ai/providers";
import { retrieveChunks } from "@/lib/retrieval";

export const maxDuration = 120;

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .min(1),
  documentId: z.string().uuid().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
});

const INSTRUCTIONS = `You are a helpful assistant that answers questions about the user's uploaded documents.
Answer using the document excerpts provided in <documents>. Each excerpt has a source number.
Cite sources inline like [1] or [2] after the statements they support.
If the excerpts don't contain the answer, say so plainly rather than guessing.
Use Markdown for lists and tables when it helps readability.`;

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const { messages, documentId, model: requestedModel } = parsed.data;

  const providerId = parsed.data.provider ?? defaultProviderId();
  if (!providerId || !isProviderId(providerId) || !providers[providerId].isConfigured()) {
    return Response.json(
      { error: "No chat provider is configured. Add a provider API key to .env.local (see README)." },
      { status: 400 },
    );
  }
  const provider = providers[providerId];
  const modelId = requestedModel?.trim() || provider.defaultModel();

  const question = messages.findLast((m) => m.role === "user")!.content;
  const chunks = await retrieveChunks(question, documentId);

  const context = chunks.length
    ? chunks
        .map(
          (c, i) =>
            `<source id="${i + 1}" file="${c.fileName}"${c.pageNumber ? ` page="${c.pageNumber}"` : ""}>\n${c.content}\n</source>`,
        )
        .join("\n\n")
    : "No processed documents are available yet.";

  // Retrieved context rides along with the latest question so earlier turns stay unchanged.
  const modelMessages: ModelMessage[] = messages.map((m, i) =>
    i === messages.length - 1
      ? { role: "user", content: `<documents>\n${context}\n</documents>\n\n${m.content}` }
      : m,
  );

  const result = streamText({
    model: provider.model(modelId),
    instructions: INSTRUCTIONS,
    messages: modelMessages,
    onError({ error }) {
      console.error(`[chat] ${providerId}/${modelId} failed`, error);
    },
  });

  // Stream plain text, but surface provider errors to the user instead of ending silently.
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for await (const part of result.stream) {
        if (part.type === "text-delta") {
          controller.enqueue(encoder.encode(part.text));
        } else if (part.type === "error") {
          const message = part.error instanceof Error ? part.error.message : String(part.error);
          controller.enqueue(encoder.encode(`\n\n⚠️ ${provider.label} error: ${message}`));
        }
      }
      controller.close();
    },
  });

  const sources = chunks.map((c, i) => ({
    id: i + 1,
    documentId: c.documentId,
    fileName: c.fileName,
    pageNumber: c.pageNumber,
  }));

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Chat-Provider": providerId,
      "X-Chat-Model": encodeURIComponent(modelId),
      "X-Chat-Sources": encodeURIComponent(JSON.stringify(sources)),
    },
  });
}
