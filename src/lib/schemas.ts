import { z } from "zod";
import { DOC_TYPES } from "./fields";

// ── Extraction (one uploaded file → one or more logical documents) ──

export const ExtractedField = z.object({
  key: z.string().describe("Catalog field key, or 'other' for a document-specific field"),
  label: z.string().describe("Human label as printed on the document"),
  value: z.string().describe("Value exactly as printed (joined onto one line)"),
  normalized: z
    .string()
    .nullable()
    .describe("Normalised value: ISO date, plain number, upper-case code; null if not applicable"),
  page: z.number().int().describe("1-based page number in the uploaded file"),
  source_text: z.string().describe("Short verbatim snippet around the value, for the reviewer"),
});

export const ExtractedLineItem = z.object({
  line_no: z.string().nullable(),
  item_code: z.string().nullable().describe("SKU / item / part number"),
  description: z.string(),
  hs_code: z.string().nullable(),
  quantity: z.number().nullable(),
  uom: z.string().nullable().describe("Unit of measure as printed, e.g. EA, PCS, KGM, CTNS"),
  unit_price: z.number().nullable(),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  weight_kg: z.number().nullable(),
  origin_country: z.string().nullable(),
  origin_criterion: z.string().nullable(),
  invoice_ref: z.string().nullable().describe("Invoice this line belongs to, when known"),
  page: z.number().int(),
});

export const ExtractedDocument = z.object({
  doc_type: z.enum(DOC_TYPES),
  doc_subtype: z
    .string()
    .nullable()
    .describe("e.g. 'House BL', 'Master BL', 'Draft', 'Original'; null if none"),
  title: z.string().describe("Short title, e.g. 'Commercial invoice SO3365348'"),
  doc_number: z.string().nullable(),
  pages: z.array(z.number().int()),
  fields: z.array(ExtractedField),
  line_items: z.array(ExtractedLineItem),
  quality_notes: z
    .array(z.string())
    .describe("Legibility problems, handwritten edits, stamps, DRAFT marks, illegible values"),
});

export const ExtractionResult = z.object({
  documents: z.array(ExtractedDocument),
});

export type ExtractionResult = z.infer<typeof ExtractionResult>;
export type ExtractedDocument = z.infer<typeof ExtractedDocument>;

// ── Comparison (all documents → report) ──

export const STATUSES = ["match", "minor", "mismatch", "missing", "single_source"] as const;
export type Status = (typeof STATUSES)[number];

export const ValueRef = z.object({
  doc_ref: z.string(),
  value: z.string().describe("Value as shown on that document; empty string if absent"),
  page: z.number().int().nullable(),
  source_text: z.string().nullable(),
});

export const HeaderComparison = z.object({
  key: z.string(),
  label: z.string(),
  category: z.string(),
  status: z.enum(STATUSES),
  values: z.array(ValueRef),
  reasoning: z.string().describe("One or two sentences explaining the verdict"),
  suggested_action: z.string().nullable(),
});

export const LineCell = z.object({
  doc_ref: z.string(),
  line_no: z.string().nullable(),
  description: z.string().nullable(),
  hs_code: z.string().nullable(),
  quantity: z.number().nullable(),
  uom: z.string().nullable(),
  amount: z.number().nullable(),
  page: z.number().int().nullable(),
});

export const LineComparison = z.object({
  item_key: z.string().describe("Item code if available, else a short description"),
  description: z.string(),
  status: z.enum(STATUSES),
  cells: z.array(LineCell),
  reasoning: z.string(),
});

export const ConsistencyCheck = z.object({
  title: z.string(),
  status: z.enum(STATUSES),
  detail: z.string(),
  doc_refs: z.array(z.string()),
});

export const ComparisonResult = z.object({
  shipment_ref: z.string().describe("Best shipment reference, e.g. House BL number"),
  summary: z.string().describe("3-5 sentence plain summary for the reviewer"),
  overall: z.enum(["clear", "review", "mismatch"]),
  missing_documents: z.array(z.string()),
  header_fields: z.array(HeaderComparison),
  line_items: z.array(LineComparison),
  checks: z.array(ConsistencyCheck),
});

export type ComparisonResult = z.infer<typeof ComparisonResult>;
