import { eq } from "drizzle-orm";
import { appSettings, db } from "@/db";
import { extractors, isExtractorId } from "./extractors";
import type { ExtractionSettings } from "./extractors/types";

const KEY = "extraction";

export type SettingSource = "app" | "env" | "default";

const env = (name: string) => process.env[name]?.trim() || undefined;

async function getStored(): Promise<Partial<ExtractionSettings>> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
  return (row?.value as Partial<ExtractionSettings>) ?? {};
}

/**
 * Resolves each setting with precedence: Settings page (database) → env var → default.
 * DOCUMENT_EXTRACTOR=auto (the default) picks Azure when it is configured, else local.
 */
export async function resolveExtractionSettings(): Promise<{
  settings: ExtractionSettings;
  sources: Record<keyof ExtractionSettings, SettingSource>;
}> {
  const stored = await getStored();

  const pick = (value: string | undefined, envName: string, fallback: string) => {
    if (value) return [value, "app"] as const;
    const fromEnv = env(envName);
    if (fromEnv) return [fromEnv, "env"] as const;
    return [fallback, "default"] as const;
  };

  const [requested, extractorSource] = pick(stored.extractor, "DOCUMENT_EXTRACTOR", "auto");
  const extractor =
    requested !== "auto" && isExtractorId(requested)
      ? requested
      : extractors.azure.isConfigured() ? "azure" : "local";
  const [azureModel, azureModelSource] = pick(stored.azureModel, "AZURE_DOCUMENT_INTELLIGENCE_MODEL", "prebuilt-layout");
  const [ocrLanguages, ocrLanguagesSource] = pick(stored.ocrLanguages, "LOCAL_OCR_LANGUAGES", "eng");

  return {
    settings: { extractor, azureModel, ocrLanguages },
    sources: { extractor: extractorSource, azureModel: azureModelSource, ocrLanguages: ocrLanguagesSource },
  };
}

/** Saves overrides from the Settings page. Empty values are removed so the env var / default applies again. */
export async function saveExtractionSettings(update: Partial<ExtractionSettings>) {
  const merged: Partial<ExtractionSettings> = { ...(await getStored()), ...update };
  for (const k of Object.keys(merged) as (keyof ExtractionSettings)[]) {
    if (!merged[k]) delete merged[k];
  }
  await db
    .insert(appSettings)
    .values({ key: KEY, value: merged })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: merged, updatedAt: new Date() } });
}
