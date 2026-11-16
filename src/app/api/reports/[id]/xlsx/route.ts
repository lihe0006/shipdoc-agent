import ExcelJS from "exceljs";
import { DOC_TYPE_SHORT, type DocType } from "@/lib/fields";
import type { Status } from "@/lib/schemas";
import { effectiveStatus, findingId, reportCounts, store } from "@/lib/store";

export const runtime = "nodejs";

const STATUS_LABEL: Record<Status, string> = {
  match: "Match",
  minor: "Minor difference",
  mismatch: "Mismatch",
  missing: "Missing",
  single_source: "Single source",
};
const STATUS_FILL: Record<Status, string> = {
  match: "FFE6F7EF",
  minor: "FFFEF0C7",
  mismatch: "FFFFE4E4",
  missing: "FFEEEFFC",
  single_source: "FFF3F5F8",
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = store.reports.get(id);
  if (!report) return new Response("Not found", { status: 404 });
  const r = report.result;
  const docHead = (ref: string) => {
    const d = report.docs.find((x) => x.ref === ref)!;
    return `${ref} ${DOC_TYPE_SHORT[d.docType as DocType]}${d.subtype ? ` (${d.subtype})` : ""}`;
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = "Shipment document agent";

  const styleHeader = (ws: ExcelJS.Worksheet) => {
    const row = ws.getRow(1);
    row.font = { bold: true };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCFCFF" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  const paint = (cell: ExcelJS.Cell, s: Status) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_FILL[s] } });

  // Summary
  const sum = wb.addWorksheet("Summary");
  const counts = reportCounts(report);
  sum.columns = [{ width: 24 }, { width: 100 }];
  sum.addRows([
    ["Shipment", r.shipment_ref],
    ["Overall", r.overall],
    ["Summary", r.summary],
    ["Missing documents", r.missing_documents.join(", ") || "—"],
    [],
    ...Object.entries(counts).map(([k, v]) => [STATUS_LABEL[k as Status], v]),
    [],
    ["Documents", ""],
    ...report.docs.map((d) => [docHead(d.ref), `${d.title} — ${d.fileName} (pages ${d.pages.join(", ")})`]),
  ]);
  sum.getColumn(1).font = { bold: true };
  sum.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  // Data fields
  const refs = report.docs.map((d) => d.ref);
  const hf = wb.addWorksheet("Data fields");
  hf.columns = [
    { header: "ID", width: 6 },
    { header: "Status", width: 16 },
    { header: "Category", width: 14 },
    { header: "Field", width: 26 },
    ...refs.map((ref) => ({ header: docHead(ref), width: 34 })),
    { header: "Agent reasoning", width: 60 },
    { header: "Suggested action", width: 40 },
    { header: "Override note", width: 30 },
  ];
  r.header_fields.forEach((f, i) => {
    const fid = findingId("h", i);
    const s = effectiveStatus(report, fid, f.status);
    const row = hf.addRow([
      fid,
      STATUS_LABEL[s],
      f.category,
      f.label,
      ...refs.map((ref) => {
        const v = f.values.find((x) => x.doc_ref === ref);
        return v ? `${v.value || "—"}${v.page ? `  (p.${v.page})` : ""}` : "";
      }),
      f.reasoning,
      f.suggested_action ?? "",
      report.overrides[fid]?.note ?? "",
    ]);
    paint(row.getCell(2), s);
    row.alignment = { wrapText: true, vertical: "top" };
  });
  styleHeader(hf);

  // Line items
  const lineRefs = refs.filter((ref) => r.line_items.some((l) => l.cells.some((c) => c.doc_ref === ref)));
  const li = wb.addWorksheet("Line items");
  li.columns = [
    { header: "ID", width: 6 },
    { header: "Status", width: 16 },
    { header: "Item", width: 18 },
    { header: "Description", width: 36 },
    ...lineRefs.map((ref) => ({ header: docHead(ref), width: 30 })),
    { header: "Agent reasoning", width: 60 },
  ];
  r.line_items.forEach((l, i) => {
    const fid = findingId("l", i);
    const s = effectiveStatus(report, fid, l.status);
    const row = li.addRow([
      fid,
      STATUS_LABEL[s],
      l.item_key,
      l.description,
      ...lineRefs.map((ref) => {
        const c = l.cells.find((x) => x.doc_ref === ref);
        if (!c) return "—";
        return [`Qty ${c.quantity ?? "—"} ${c.uom ?? ""}`.trim(), c.hs_code ? `HS ${c.hs_code}` : "", c.amount != null ? `Amt ${c.amount}` : "", c.page ? `p.${c.page}` : ""]
          .filter(Boolean)
          .join(" · ");
      }),
      l.reasoning,
    ]);
    paint(row.getCell(2), s);
    row.alignment = { wrapText: true, vertical: "top" };
  });
  styleHeader(li);

  // Checks
  const ck = wb.addWorksheet("Consistency checks");
  ck.columns = [
    { header: "ID", width: 6 },
    { header: "Status", width: 16 },
    { header: "Check", width: 36 },
    { header: "Detail", width: 100 },
    { header: "Documents", width: 20 },
  ];
  r.checks.forEach((c, i) => {
    const fid = findingId("c", i);
    const s = effectiveStatus(report, fid, c.status);
    const row = ck.addRow([fid, STATUS_LABEL[s], c.title, c.detail, c.doc_refs.join(", ")]);
    paint(row.getCell(2), s);
    row.alignment = { wrapText: true, vertical: "top" };
  });
  styleHeader(ck);

  const buf = await wb.xlsx.writeBuffer();
  const safe = r.shipment_ref.replace(/[^A-Za-z0-9_-]+/g, "_") || "shipment";
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="document-check-${safe}.xlsx"`,
    },
  });
}
