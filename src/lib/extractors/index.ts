import { azureExtractor } from "./azure";
import { localExtractor } from "./local";
import type { Extractor } from "./types";

/** Registered extractors. Add a new service by implementing `Extractor` and listing it here. */
export const extractors = {
  azure: azureExtractor,
  local: localExtractor,
} satisfies Record<string, Extractor>;

export type ExtractorId = keyof typeof extractors;

export function isExtractorId(id: string): id is ExtractorId {
  return id in extractors;
}
