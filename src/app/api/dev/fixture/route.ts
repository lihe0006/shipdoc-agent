import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { createSession, saveUpload, store, type DocRef, type Report } from "@/lib/store";
import type { ComparisonResult } from "@/lib/schemas";

/**
 * DEV ONLY: renders the results page without calling the API, using the sample
 * files and a small hand-written report. Not real agent output.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") return new NextResponse("Not found", { status: 404 });
  const dir = path.join(process.cwd(), "..", "MULTRANS GLOBAL SDN BHD sample docs ");
  const names = ["CIPL SHINS.pdf", "JGCSE26100206-DRAFT LCL (1).pdf", "Form E.pdf"];
  const session = createSession();
  const files = [];
  for (const n of names) files.push(await saveUpload(session.id, n, "application/pdf", await fs.readFile(path.join(dir, n))));

  const docs: DocRef[] = [
    { ref: "D1", fileId: files[0].id, docIndex: 0, fileName: names[0], docType: "commercial_invoice", subtype: null, title: "Commercial invoices (3)", docNumber: "SO3365348 / SO3434509 / SO3345839", pages: [1, 3, 4, 7] },
    { ref: "D2", fileId: files[1].id, docIndex: 0, fileName: names[1], docType: "bill_of_lading", subtype: "House BL · Draft", title: "House BL JGCSE26100206", docNumber: "JGCSE26100206", pages: [1] },
    { ref: "D3", fileId: files[2].id, docIndex: 0, fileName: names[2], docType: "form_e", subtype: null, title: "Form E E26MA28EJ7862204", docNumber: "E26MA28EJ7862204", pages: [1, 2, 3, 4, 5, 6, 7] },
  ];
  const v = (doc_ref: string, value: string, page: number | null, source_text: string | null = null) => ({ doc_ref, value, page, source_text });
  const result: ComparisonResult = {
    shipment_ref: "JGCSE26100206",
    summary: "[Fixture] The vessel on the Form E does not match the House BL. Quantities and HS codes agree across all documents.",
    overall: "mismatch",
    missing_documents: [],
    header_fields: [
      { key: "vessel_voyage", label: "Vessel / voyage", category: "Transport", status: "mismatch", values: [v("D1", "", null), v("D2", "COSCO NEW YORK 152W", 1), v("D3", "WAN HAI 516 W098", 1, "Vessel's name / Aircraft etc. WAN HAI 516 W098")], reasoning: "Form E names a different vessel from the House BL.", suggested_action: "Ask the shipper for an amended Form E." },
      { key: "invoice_total", label: "Invoice value", category: "Commercial", status: "single_source", values: [v("D1", "USD 5,008.68", 1), v("D2", "", null), v("D3", "", null)], reasoning: "Only the invoices carry a value; the three totals add up to USD 5,008.68.", suggested_action: null },
      { key: "gross_weight", label: "Gross weight (kg)", category: "Cargo", status: "minor", values: [v("D1", "286.44 (carton) / 372.00 (pallet)", 1), v("D2", "372KGS", 1), v("D3", "", null)], reasoning: "Carton weights exclude pallets.", suggested_action: null },
    ],
    line_items: [
      { item_key: "BWR855FFPK", description: "WB CON FRIZZ FREE DETANGLER PK", status: "match", cells: [{ doc_ref: "D1", line_no: "1", description: null, hs_code: "9615 11", quantity: 72, uom: "EA", amount: 172.8, page: 1 }, { doc_ref: "D3", line_no: "5", description: null, hs_code: "9615.11", quantity: 72, uom: "PIECES", amount: null, page: 2 }], reasoning: "Same item and HS heading." },
    ],
    checks: [{ title: "Invoice totals add up", status: "match", detail: "648.00 + 3,662.28 + 698.40 = USD 5,008.68", doc_refs: ["D1"] }],
  };
  const report: Report = { id: `fx${session.id}`, sessionId: session.id, createdAt: Date.now(), updatedAt: Date.now(), docs, result, overrides: {} };
  store.reports.set(report.id, report);
  session.reportId = report.id;
  return NextResponse.json({ reportId: report.id });
}
