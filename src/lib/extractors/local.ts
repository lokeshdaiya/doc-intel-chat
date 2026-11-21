import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  OfficeGenerator,
  OfficeParser,
  type OfficeContentNode,
  type OfficeParserAST,
} from "officeparser";
import { createWorker } from "tesseract.js";
import type { ExtractedPage, ExtractedTable, ExtractionResult, Extractor } from "./types";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"]);
// Text formats have no magic bytes, so officeparser needs to be told what they are.
const TEXT_FILE_TYPES: Record<string, "html" | "md" | "csv"> = {
  ".html": "html",
  ".htm": "html",
  ".md": "md",
  ".csv": "csv",
};

/** Below this many characters per page a PDF is treated as scanned and re-read with OCR. */
const SCANNED_PDF_CHARS_PER_PAGE = 30;

type NodeMeta = { pageNumber?: number; slideNumber?: number; sheetName?: string; row?: number; col?: number };
const meta = (node: OfficeContentNode) => (node.metadata ?? {}) as NodeMeta;

/**
 * OCRs each image as one page. Tesseract downloads language data on first use and
 * caches it in OCR_CACHE_DIR (default .cache/tesseract) instead of the working directory.
 */
async function ocrImages(images: Buffer[], languages: string): Promise<ExtractionResult> {
  const cachePath = path.resolve(process.env.OCR_CACHE_DIR || ".cache/tesseract");
  await mkdir(cachePath, { recursive: true });

  const worker = await createWorker(languages, undefined, { cachePath });
  try {
    const pages: ExtractedPage[] = [];
    const confidence: number[] = [];
    let content = "";
    for (const [i, image] of images.entries()) {
      const { data } = await worker.recognize(image);
      const text = data.text.trim();
      if (!text) continue;
      if (content) content += "\n\n";
      pages.push({ pageNumber: i + 1, offset: content.length, length: text.length });
      content += text;
      confidence.push(data.confidence);
    }
    return { content, pages, tables: [], fields: [], modelId: `local:tesseract-${languages}`, raw: { confidence } };
  } finally {
    await worker.terminate();
  }
}

/** A node's text; some parsers (e.g. HTML) only set it on the leaf `text` nodes. */
function nodeText(node: OfficeContentNode): string {
  if (node.text?.trim()) return node.text;
  return (node.children ?? []).map(nodeText).filter(Boolean).join(" ");
}

/** Builds a 2D grid of cell text from a `table` or `sheet` node (table → row → cell). */
function toRows(node: OfficeContentNode): string[][] {
  const rows: string[][] = [];
  (node.children ?? [])
    .filter((r) => r.type === "row")
    .forEach((row, rowIndex) => {
      const cells: string[] = [];
      (row.children ?? [])
        .filter((c) => c.type === "cell")
        .forEach((cell, i) => {
          cells[meta(cell).col ?? i] = nodeText(cell).trim();
        });
      rows[meta(row).row ?? rowIndex] = Array.from(cells, (c) => c ?? "");
    });
  return Array.from(rows, (r) => r ?? []).filter((r) => r.some(Boolean));
}

function collectTables(nodes: OfficeContentNode[], pageNumber: number | null, out: ExtractedTable[]) {
  for (const node of nodes) {
    if (node.type === "table" || node.type === "sheet") {
      const rows = toRows(node);
      if (rows.length) out.push({ pageNumber, rows });
      // Nested tables inside cells are still part of this one; don't double count.
      continue;
    }
    if (node.children?.length) collectTables(node.children, pageNumber, out);
  }
}

/** The page number a top-level node represents: PDF page, slide, or sheet position. */
function unitNumber(node: OfficeContentNode, index: number): number | null {
  if (node.type === "page") return meta(node).pageNumber ?? index + 1;
  if (node.type === "slide") return meta(node).slideNumber ?? index + 1;
  if (node.type === "sheet") return index + 1;
  return null;
}

async function toMarkdown(ast: OfficeParserAST, content: OfficeContentNode[]): Promise<string> {
  const { value } = await OfficeGenerator.generate(
    { ...ast, content, metadata: {} } as OfficeParserAST,
    "md",
    // No images: OCR'd scans would otherwise be embedded as base64 data URIs.
    { generateIds: false, includeImages: false },
  );
  // The generator always writes a YAML front-matter block (and a rule after it); drop both.
  return String(value)
    .replace(/^\s*---\r?\n[\s\S]*?\r?\n---\s*/, "")
    .replace(/^---\s*/, "")
    // Heading anchors such as "## Totals {#totals}" come from bookmarks in the source file.
    .replace(/[ \t]+\{#[^}\s]+\}[ \t]*$/gm, "")
    .trim();
}

/**
 * Converts the AST to Markdown. Paged formats (PDF pages, PPTX slides, XLSX sheets)
 * are rendered one unit at a time so each page's position in `content` is known.
 */
async function astToResult(ast: OfficeParserAST, modelId: string): Promise<ExtractionResult> {
  const units = ast.content.filter((n) => unitNumber(n, 0) !== null);
  const pages: ExtractedPage[] = [];
  const tables: ExtractedTable[] = [];
  let content = "";

  if (units.length && units.length === ast.content.length) {
    for (const [i, node] of units.entries()) {
      const pageNumber = unitNumber(node, i)!;
      let md = await toMarkdown(ast, [node]);
      if (node.type === "sheet") md = `## ${meta(node).sheetName ?? `Sheet ${pageNumber}`}\n\n${md}`;
      if (node.type === "slide") md = `## Slide ${pageNumber}\n\n${md}`;
      if (content) content += "\n\n";
      pages.push({ pageNumber, offset: content.length, length: md.length });
      content += md;
      collectTables([node], pageNumber, tables);
    }
  } else {
    content = await toMarkdown(ast, ast.content);
    if (content) pages.push({ pageNumber: 1, offset: 0, length: content.length });
    collectTables(ast.content, null, tables);
  }

  return { content, pages, tables, fields: [], modelId, raw: { type: ast.type, metadata: ast.metadata } };
}

export const localExtractor: Extractor = {
  id: "local",
  label: "Local (open source)",
  description:
    "Runs on this server, free and offline after setup: officeparser for PDF, Word, Excel, PowerPoint, HTML and OpenDocument, and Tesseract OCR for images and scanned PDFs. Less accurate than Azure on scans and complex layouts.",
  isConfigured: () => true,

  async extract({ file, fileName, settings }) {
    const ext = path.extname(fileName).toLowerCase();
    const languages = settings.ocrLanguages || "eng";

    if (IMAGE_EXTENSIONS.has(ext)) return ocrImages([file], languages);
    if (ext === ".heif") {
      throw new Error("The local extractor can't read HEIF images. Convert to JPG/PNG or use Azure.");
    }

    const ast = await OfficeParser.parseOffice(file, { fileType: TEXT_FILE_TYPES[ext] });
    let result = await astToResult(ast, "local:officeparser");

    // A PDF with (almost) no text layer is a scan: pull out its page images and OCR them.
    const isScannedPdf =
      ast.type === "pdf" &&
      result.content.replace(/\s/g, "").length < SCANNED_PDF_CHARS_PER_PAGE * Math.max(1, result.pages.length);
    if (isScannedPdf) {
      const withImages = await OfficeParser.parseOffice(file, { extractAttachments: true });
      const images = withImages.attachments
        .filter((a) => a.type === "image" && a.mimeType.startsWith("image/"))
        .map((a) => Buffer.from(a.data, "base64"));
      if (images.length) result = await ocrImages(images, languages);
    }

    if (!result.content.trim()) {
      throw new Error("No text could be extracted from this file.");
    }
    return result;
  },
};
