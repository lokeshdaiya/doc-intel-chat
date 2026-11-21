import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const documentStatus = pgEnum("document_status", [
  "uploaded",
  "processing",
  "ready",
  "failed",
]);

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storagePath: text("storage_path").notNull(),
  status: documentStatus("status").notNull().default("uploaded"),
  error: text("error"),
  modelId: text("model_id"),
  pageCount: integer("page_count"),
  /** Full document content as Markdown, produced by Document Intelligence. */
  content: text("content"),
  /** Raw analyzeResult from Document Intelligence, kept for later re-use. */
  rawResult: jsonb("raw_result"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: serial("id").primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    pageNumber: integer("page_number"),
    content: text("content").notNull(),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', content)`,
    ),
  },
  (t) => [
    index("document_chunks_document_idx").on(t.documentId),
    index("document_chunks_search_idx").using("gin", t.searchVector),
  ],
);

export const documentTables = pgTable(
  "document_tables",
  {
    id: serial("id").primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    tableIndex: integer("table_index").notNull(),
    pageNumber: integer("page_number"),
    rowCount: integer("row_count").notNull(),
    columnCount: integer("column_count").notNull(),
    /** 2D array of cell text: rows[rowIndex][columnIndex]. */
    rows: jsonb("rows").$type<string[][]>().notNull(),
  },
  (t) => [index("document_tables_document_idx").on(t.documentId)],
);

export const documentFields = pgTable(
  "document_fields",
  {
    id: serial("id").primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value"),
    confidence: real("confidence"),
    pageNumber: integer("page_number"),
  },
  (t) => [index("document_fields_document_idx").on(t.documentId)],
);

export type Document = typeof documents.$inferSelect;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type DocumentTable = typeof documentTables.$inferSelect;
export type DocumentField = typeof documentFields.$inferSelect;
