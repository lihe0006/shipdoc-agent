import { NextResponse } from "next/server";
import { STATUSES, type Status } from "@/lib/schemas";
import { effectiveStatus, reportCounts, store } from "@/lib/store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = store.reports.get(id);
  if (!report) return NextResponse.json({ error: "Report not found. Reports are kept in memory and are cleared when the server restarts." }, { status: 404 });
  return NextResponse.json({ ...report, counts: reportCounts(report) });
}

/** Reviewer override from the results page. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = store.reports.get(id);
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  const { findingId: fid, status, note } = (await req.json()) as { findingId: string; status: Status | null; note?: string };

  const m = /^([hlc])(\d+)$/.exec(fid ?? "");
  const list = m && { h: report.result.header_fields, l: report.result.line_items, c: report.result.checks }[m[1] as "h" | "l" | "c"];
  const item = m && list ? list[Number(m[2]) - 1] : undefined;
  if (!item) return NextResponse.json({ error: "Unknown finding" }, { status: 400 });

  if (status === null) delete report.overrides[fid];
  else if (STATUSES.includes(status)) {
    report.overrides[fid] = { status, note: note ?? "", by: "user", at: Date.now(), previousStatus: effectiveStatus(report, fid, item.status) };
  } else return NextResponse.json({ error: "Bad status" }, { status: 400 });

  report.updatedAt = Date.now();
  // Let the agent know in its next turn so chat and page stay consistent.
  const session = store.sessions.get(report.sessionId);
  session?.pendingNotes.push(
    `[Reviewer action on results page] ${status === null ? `Cleared override on ${fid}` : `Set ${fid} to ${status}${note ? ` — "${note}"` : ""}`}.`,
  );
  return NextResponse.json({ ...report, counts: reportCounts(report) });
}
