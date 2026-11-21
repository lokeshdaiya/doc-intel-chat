import DocumentIntelligence, {
  getLongRunningPoller,
  isUnexpected,
  type AnalyzeOperationOutput,
  type AnalyzeResultOutput,
} from "@azure-rest/ai-document-intelligence";
import { AzureKeyCredential } from "@azure/core-auth";
import type { ExtractedField, Extractor } from "./types";

const env = (name: string) => process.env[name]?.trim() || undefined;

function getClient() {
  const endpoint = env("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT");
  const key = env("AZURE_DOCUMENT_INTELLIGENCE_KEY");
  if (!endpoint || !key) {
    throw new Error(
      "Azure Document Intelligence is not configured. Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY.",
    );
  }
  return DocumentIntelligence(endpoint, new AzureKeyCredential(key));
}

/**
 * Sends a document to Azure AI Document Intelligence and waits for the result.
 * Content is returned as Markdown so headings and tables survive for chat context.
 */
async function analyze(file: Buffer, modelId: string): Promise<AnalyzeResultOutput> {
  const client = getClient();
  const initialResponse = await client
    .path("/documentModels/{modelId}:analyze", modelId)
    .post({
      contentType: "application/json",
      body: { base64Source: file.toString("base64") },
      queryParameters: {
        outputContentFormat: "markdown",
        // Key-value extraction is an add-on for the layout model; prebuilt models
        // like invoice/receipt return typed fields in `documents` instead.
        ...(modelId === "prebuilt-layout" ? { features: ["keyValuePairs"] } : {}),
      },
    });

  if (isUnexpected(initialResponse)) {
    throw new Error(
      `Document Intelligence rejected the request: ${initialResponse.body.error?.message ?? initialResponse.status}`,
    );
  }

  const poller = getLongRunningPoller(client, initialResponse);
  const output = (await poller.pollUntilDone()).body as AnalyzeOperationOutput;

  if (output.status !== "succeeded" || !output.analyzeResult) {
    throw new Error(
      `Document analysis ${output.status}: ${output.error?.message ?? "no result returned"}`,
    );
  }
  return output.analyzeResult;
}

/**
 * Collects key-value pairs from the layout model, plus typed fields when a
 * prebuilt model such as prebuilt-invoice or prebuilt-receipt is used.
 */
function extractFields(result: AnalyzeResultOutput): ExtractedField[] {
  const fields: ExtractedField[] = [];

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

export const azureExtractor: Extractor = {
  id: "azure",
  label: "Azure AI Document Intelligence",
  description:
    "Cloud OCR and layout analysis. Best quality for scanned documents, tables and forms. Billed per page.",
  isConfigured: () =>
    !!env("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT") && !!env("AZURE_DOCUMENT_INTELLIGENCE_KEY"),
  configHint: "Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY in .env.local.",

  async extract({ file, settings }) {
    const modelId = settings.azureModel;
    const result = await analyze(file, modelId);

    return {
      content: result.content ?? "",
      // A page can have several spans; the first one marks where it starts.
      pages: (result.pages ?? []).map((p) => ({
        pageNumber: p.pageNumber,
        offset: p.spans?.[0]?.offset ?? 0,
        length: (p.spans ?? []).reduce((sum, s) => sum + s.length, 0),
      })),
      tables: (result.tables ?? []).map((table) => {
        const rows = Array.from({ length: table.rowCount }, () =>
          Array<string>(table.columnCount).fill(""),
        );
        for (const cell of table.cells) rows[cell.rowIndex][cell.columnIndex] = cell.content;
        return { pageNumber: table.boundingRegions?.[0]?.pageNumber ?? null, rows };
      }),
      fields: extractFields(result),
      modelId: `azure:${modelId}`,
      raw: result,
    };
  },
};
