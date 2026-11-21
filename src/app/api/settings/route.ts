import { connection } from "next/server";
import { z } from "zod";
import { extractors } from "@/lib/extractors";
import type { Extractor } from "@/lib/extractors/types";
import { resolveExtractionSettings, saveExtractionSettings } from "@/lib/settings";

async function current() {
  const { settings, sources } = await resolveExtractionSettings();
  return {
    settings,
    sources,
    extractors: Object.values(extractors).map((e: Extractor) => ({
      id: e.id,
      label: e.label,
      description: e.description,
      configured: e.isConfigured(),
      configHint: e.configHint ?? null,
    })),
  };
}

export async function GET() {
  await connection();
  return Response.json(await current());
}

// An empty string clears the override so the env var / default applies again.
const updateSchema = z.object({
  extractor: z.enum(["", "auto", ...Object.keys(extractors)]).optional(),
  azureModel: z.string().trim().max(100).regex(/^[\w.\-]*$/, "Invalid model id").optional(),
  ocrLanguages: z.string().trim().max(100).regex(/^[a-z_]*(\+[a-z_]+)*$/i, "Use codes like eng or eng+hin").optional(),
});

export async function PUT(request: Request) {
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }
  const { extractor } = parsed.data;
  if (extractor && extractor !== "auto" && !extractors[extractor as keyof typeof extractors].isConfigured()) {
    return Response.json(
      { error: `${extractors[extractor as keyof typeof extractors].label} is not configured.` },
      { status: 400 },
    );
  }
  await saveExtractionSettings(parsed.data);
  return Response.json(await current());
}
