import { promises as fs } from "fs";
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { client, FALLBACK_BETA, MODEL } from "./claude";
import { fieldCatalogText } from "./fields";
import { ExtractionResult } from "./schemas";
import type { StoredFile } from "./store";

const EXTRACTION_SYSTEM = `You are a meticulous Malaysian import-documentation clerk. You read shipping documents (digital or scanned) and transcribe their data fields exactly.

Document types you will see:
- commercial_invoice: seller's invoice (CI). A "CIPL" file holds commercial invoices AND packing lists.
- packing_list: packing list / packing slip (PL).
- bill_of_lading: ocean bill of lading. Distinguish "House BL" (issued by the forwarder/NVOCC to the seller, names the real seller as shipper) from "Master BL" (issued by the carrier, shipper is usually the origin forwarder). Put this in doc_subtype, plus "Draft" if marked draft.
- k1: Malaysian Customs No.1 import declaration (Kastam No.1). Multi-page; header boxes repeat on every page, line items continue across pages.
- form_e: ASEAN-China FTA Certificate of Origin (Form E). Multi-page; header boxes are filled on page 1 only and items continue across pages.
- other: anything else.

Grouping rules:
- One uploaded file can contain several documents. Return each logical document separately with its page numbers.
- Group ALL commercial invoices in the file into ONE commercial_invoice document, and ALL packing lists into ONE packing_list document. When a field differs per invoice (invoice number, gross weight, cartons, total), give every invoice's value and the combined total in "value", e.g. "SO1 USD 648.00; SO2 USD 3,662.28; total USD 4,310.28". Tag each line item with invoice_ref.
- Pages that only repeat a header (e.g. K1 continuation pages) do not create a new document.

Field extraction rules:
- Use these catalog keys wherever the field exists on the document. Use key "other" for important document-specific fields not in the catalog (e.g. K1 importer code, exchange rate, duty amounts, BL number of originals, Form E third-party invoicing tick box, pallet details).
- Transcribe values exactly as printed, including typos and odd characters (O vs 0). Do not correct or infer — the point is to find discrepancies. If a value is illegible write "[illegible]" and note it in quality_notes.
- "page" is the 1-based page of the uploaded file where the value appears. "source_text" is a short verbatim snippet (≤ 120 chars) the reviewer can find on that page.
- For Form E record whether box 13 "Third Party Invoicing" is ticked and who the third-party operator is.
- For K1, also extract the total invoice value in foreign currency, FOB/CIF in RM, exchange rate, and the preferential claim text referencing the Form E.
- Extract EVERY line item on every page. Quantities, prices, amounts and weights are numbers (no currency symbols or thousands separators). Keep the document's own unit of measure (K1 often uses KGM tariff units).
- Note DRAFT / COPY watermarks, stamps, handwriting and unreadable areas in quality_notes.

Catalog:
${fieldCatalogText()}`;

export async function extractFile(file: StoredFile): Promise<ExtractionResult> {
  const bytes = await fs.readFile(file.path);
  const data = bytes.toString("base64");
  const isPdf = file.mediaType === "application/pdf";

  const source: Anthropic.Beta.BetaContentBlockParam = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data }, title: file.name }
    : {
        type: "image",
        source: { type: "base64", media_type: file.mediaType as "image/png" | "image/jpeg" | "image/webp", data },
      };

  const stream = client().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(ExtractionResult) },
    system: EXTRACTION_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          source,
          { type: "text", text: `File name: "${file.name}". Identify every document in this file and extract all fields and line items.` },
        ],
      },
    ],
  });

  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error(`The model declined to read ${file.name}.`);
  if (msg.stop_reason === "max_tokens") throw new Error(`Extraction of ${file.name} was cut off (output too long).`);
  if (!msg.parsed_output) throw new Error(`Could not parse the extraction for ${file.name}.`);
  return msg.parsed_output;
}

/** Compact summary the agent sees (keeps its context small). */
export function summarizeExtraction(file: StoredFile) {
  if (!file.extraction) return { file: file.name, error: file.extractionError ?? "not extracted" };
  return {
    file: file.name,
    documents: file.extraction.documents.map((d) => ({
      type: d.doc_type,
      subtype: d.doc_subtype,
      title: d.title,
      number: d.doc_number,
      pages: d.pages,
      fields_found: d.fields.length,
      line_items: d.line_items.length,
      quality_notes: d.quality_notes,
    })),
  };
}
