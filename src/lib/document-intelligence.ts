import DocumentIntelligence, {
  getLongRunningPoller,
  isUnexpected,
  type AnalyzeOperationOutput,
  type AnalyzeResultOutput,
} from "@azure-rest/ai-document-intelligence";
import { AzureKeyCredential } from "@azure/core-auth";

function getClient() {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  if (!endpoint || !key) {
    throw new Error(
      "Azure Document Intelligence is not configured. Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY.",
    );
  }
  return DocumentIntelligence(endpoint, new AzureKeyCredential(key));
}

export function getModelId() {
  return process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL || "prebuilt-layout";
}

/**
 * Sends a document to Azure AI Document Intelligence and waits for the result.
 * Content is returned as Markdown so headings and tables survive for chat context.
 */
export async function analyzeDocument(file: Buffer): Promise<AnalyzeResultOutput> {
  const client = getClient();
  const modelId = getModelId();

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
