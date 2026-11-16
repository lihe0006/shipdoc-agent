import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { nanoid } from "nanoid";
import { client, FALLBACK_BETA, MODEL } from "./claude";
import { DOC_TYPE_LABEL, fieldCatalogText, type DocType } from "./fields";
import { ComparisonResult } from "./schemas";
import { store, type DocRef, type Report, type Session } from "./store";

const COMPARE_SYSTEM = `You are a senior Malaysian customs documentation checker. You receive data extracted from one shipment's documents (commercial invoice, packing list, bills of lading, K1 customs declaration, Form E certificate of origin). Compare every common data field across documents and judge each difference like an experienced reviewer would.

Statuses:
- match: same in substance (formatting, case, punctuation, abbreviations, line wraps, unit notation and equivalent names are ignored).
- minor: differs but is explainable or low-risk (typo, O/0 confusion, missing voyage number, carton vs pallet weight, EXW invoice vs FOB declaration). Explain why.
- mismatch: a real discrepancy that could cause a customs query, loss of Form E preference, or a wrong declaration (different vessel, value, quantity, HS heading, party, container).
- missing: the field is expected on a document that should carry it (per the catalog) but is absent or illegible there.
- single_source: only one document carries this field; shown for completeness.

How to judge:
- Decide the source of truth per field yourself: commercial documents (invoice/packing list) usually lead for goods, value and quantity; the House BL leads for transport; the K1 must agree with both; the Form E must agree with the shipment it certifies. Say which document you relied on when it matters.
- Aggregate same-type documents when the shipment has several (e.g. three invoices → compare their combined total and combined line items with the K1 and Form E).
- Compare like with like (pallets vs cartons, KGM vs pieces). Do not call different packing levels or tariff units a mismatch.
- Do arithmetic: sum line amounts vs invoice totals, sum invoice totals vs K1 invoice value, K1 FOB in RM vs invoice value × exchange rate, carton counts per invoice vs Form E total, weights and CBM across documents, number of line items per document.
- Check dates for logic: Form E issue vs departure, departure vs K1 import date.
- Treat Master and House BL as two documents of different levels; differences that are normal between them (shipper, freight terms, BL number) are minor or match with an explanation, but quantity/weight/CBM/container must agree.

Output rules:
- header_fields: one row per catalog field that appears on at least one document (use catalog keys and labels; add extra rows with key "other_<name>" for important cross-document facts you discovered). Include one entry in "values" for EVERY document reference that should carry the field (empty value string if absent), with page and a short source_text from the extraction.
- line_items: one row per distinct item (match items across documents by item code first, then description). Include a cell for every document that lists line items. Flag quantity, HS code, amount or description differences; flag items missing from a document.
- checks: cross-document arithmetic and logic checks (totals, sums, counts, dates, third-party invoicing, BL linkage). State the numbers.
- Keep reasoning to one or two plain sentences. Use D MMM YYYY dates and explicit currency (USD 5,008.68).
- summary: 3-5 sentences: overall verdict, the mismatches that need action, and what is fine.
- overall: "mismatch" if any mismatch, else "review" if any minor/missing, else "clear".

Field catalog:
${fieldCatalogText()}`;

export function buildDocRefs(session: Session): DocRef[] {
  const refs: DocRef[] = [];
  for (const fileId of session.fileIds) {
    const f = store.files.get(fileId);
    if (!f?.extraction) continue;
    for (const [docIndex, d] of f.extraction.documents.entries()) {
      refs.push({
        ref: `D${refs.length + 1}`,
        fileId: f.id,
        docIndex,
        fileName: f.name,
        docType: d.doc_type,
        subtype: d.doc_subtype,
        title: d.title,
        docNumber: d.doc_number,
        pages: d.pages,
      });
    }
  }
  return refs;
}

export async function compareSession(session: Session, focusNotes?: string): Promise<Report> {
  const refs = buildDocRefs(session);
  if (refs.length < 2) throw new Error("At least two extracted documents are needed for a comparison.");

  const payload = refs.map((r) => {
    const f = store.files.get(r.fileId)!;
    const d = f.extraction!.documents[r.docIndex];
    return {
      doc_ref: r.ref,
      doc_type: `${DOC_TYPE_LABEL[r.docType as DocType]}${r.subtype ? ` (${r.subtype})` : ""}`,
      file: r.fileName,
      title: d.title,
      doc_number: d.doc_number,
      pages: d.pages,
      quality_notes: d.quality_notes,
      fields: d.fields,
      line_items: d.line_items,
    };
  });

  const presentTypes = new Set(refs.map((r) => r.docType));
  const expected: DocType[] = ["commercial_invoice", "packing_list", "bill_of_lading", "k1", "form_e"];
  const absent = expected.filter((t) => !presentTypes.has(t)).map((t) => DOC_TYPE_LABEL[t]);

  const stream = client().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: betaZodOutputFormat(ComparisonResult) },
    system: COMPARE_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `Documents in this shipment (${refs.length}):\n` +
              refs.map((r) => `- ${r.ref}: ${payload.find((p) => p.doc_ref === r.ref)!.doc_type} — ${r.title} (file "${r.fileName}")`).join("\n") +
              `\n\nDocument types not uploaded: ${absent.length ? absent.join(", ") : "none"}.` +
              (focusNotes ? `\n\nReviewer instructions for this comparison: ${focusNotes}` : "") +
              `\n\nExtracted data (JSON):\n${JSON.stringify(payload)}`,
          },
        ],
      },
    ],
  });

  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("The model declined to compare these documents.");
  if (msg.stop_reason === "max_tokens") throw new Error("The comparison output was cut off (too long).");
  if (!msg.parsed_output) throw new Error("Could not parse the comparison result.");

  const now = Date.now();
  const existing = session.reportId ? store.reports.get(session.reportId) : undefined;
  const report: Report = {
    id: existing?.id ?? nanoid(10),
    sessionId: session.id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    docs: refs,
    result: msg.parsed_output,
    overrides: {},
  };
  store.reports.set(report.id, report);
  session.reportId = report.id;
  return report;
}
