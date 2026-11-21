export type ExtractedPage = {
  pageNumber: number;
  /** Character offset of this page's text within `content`. */
  offset: number;
  length: number;
};

export type ExtractedTable = {
  pageNumber: number | null;
  /** 2D array of cell text: rows[rowIndex][columnIndex]. */
  rows: string[][];
};

export type ExtractedField = {
  key: string;
  value: string | null;
  confidence: number | null;
  pageNumber: number | null;
};

/** What every extractor returns, regardless of the service behind it. */
export type ExtractionResult = {
  /** Full document content as Markdown. */
  content: string;
  pages: ExtractedPage[];
  tables: ExtractedTable[];
  fields: ExtractedField[];
  /** Identifies what produced the result, e.g. "azure:prebuilt-layout" or "local". */
  modelId: string;
  /** Service-specific output worth keeping, stored as JSON. */
  raw?: unknown;
};

/** Extraction settings after merging the app Settings page, env vars and defaults. */
export type ExtractionSettings = {
  extractor: string;
  /** Azure model id, e.g. prebuilt-layout, prebuilt-invoice. */
  azureModel: string;
  /** Tesseract language codes for local OCR, joined with "+", e.g. "eng" or "eng+hin". */
  ocrLanguages: string;
};

export type ExtractInput = {
  file: Buffer;
  fileName: string;
  mimeType: string;
  settings: ExtractionSettings;
};

export type Extractor = {
  id: string;
  label: string;
  description: string;
  /** Whether the extractor has the configuration it needs to run. */
  isConfigured: () => boolean;
  /** Shown in the settings UI when the extractor isn't configured. */
  configHint?: string;
  extract: (input: ExtractInput) => Promise<ExtractionResult>;
};
