import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { client, describeApiError, FALLBACK_BETA, MODEL } from "./claude";
import { compareSession } from "./compare";
import { extractFile, summarizeExtraction } from "./extract";
import { DOC_TYPE_SHORT, type DocType } from "./fields";
import { STATUSES, type Status } from "./schemas";
import { effectiveStatus, findingId, reportCounts, store, type Report, type Session } from "./store";

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; label: string }
  | { type: "tool_progress"; id: string; message: string }
  | { type: "tool_end"; id: string; ok: boolean; summary: string }
  | { type: "report"; reportId: string; shipmentRef: string; overall: string; counts: Record<Status, number> }
  | { type: "error"; message: string }
  | { type: "done" };

const SYSTEM = `You are the shipment document checking assistant for a Malaysian freight forwarder. Users upload one shipment's documents — commercial invoice and packing list (CIPL), bill(s) of lading, K1 customs declaration and Form E certificate of origin — and you check that they agree with each other before the K1 is submitted.

How you work:
- When the user uploads files, call extract_documents with all new file ids, then call compare_documents. Don't ask for permission first; the upload is the request. If fewer than two documents could be read, say what is missing instead of comparing.
- compare_documents builds the results page. The chat shows a card linking to it, so don't paste URLs.
- After the comparison, reply with a short summary: the overall verdict, each mismatch with the conflicting values and which documents they come from, then minor differences in one line each. Finish with one sentence on what is consistent. Keep it scannable: short bullets, no tables, no headings larger than bold text.
- For follow-up questions, call get_report to read the details instead of guessing. Every value you quote must come from a tool result.
- When the user accepts a difference, asks you to ignore something or overrides a verdict, call update_finding (finding ids look like h3, l12, c2 — get them from get_report). When the user changes the comparison rules in general (for example "ignore weight differences under 1%"), call compare_documents again with those instructions.
- You can draft emails or messages (e.g. to the shipper or forwarder asking for a corrected Form E) directly in chat.
- If the user uploads more files later, extract them and re-run the comparison.

Voice: calm, plain and operational, like a competent colleague who has done the tedious part. First person, address the user as "you". Sentence case. No emoji. Money with an explicit currency (USD 5,008.68), dates as D MMM YYYY. AI findings are suggestions for the user to confirm, not commands.`;

// ── Tools ──

const ExtractInput = z.object({ file_ids: z.array(z.string()) });
const CompareInput = z.object({ instructions: z.string().nullable() });
const ReportInput = z.object({ section: z.enum(["overview", "header_fields", "line_items", "checks", "all"]) });
const UpdateInput = z.object({ finding_id: z.string(), status: z.enum(STATUSES), note: z.string() });

const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: "extract_documents",
    description:
      "Read uploaded files with vision and extract every data field and line item. One file may contain several documents (e.g. a CIPL holds invoices and packing lists). Already-extracted files are returned from cache. Returns a compact list of the documents found in each file.",
    input_schema: {
      type: "object",
      properties: { file_ids: { type: "array", items: { type: "string" }, description: "Uploaded file ids to read" } },
      required: ["file_ids"],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
  {
    name: "compare_documents",
    description:
      "Compare all extracted documents in this session field by field and line by line, judge each difference (match / minor / mismatch / missing / single_source) and publish the results page. Re-running replaces the previous results and clears overrides. Returns verdict counts and the non-matching findings.",
    input_schema: {
      type: "object",
      properties: {
        instructions: {
          type: ["string", "null"],
          description: "Optional reviewer rules for this run, e.g. 'treat weight differences under 1% as match'. null for none.",
        },
      },
      required: ["instructions"],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
  {
    name: "get_report",
    description: "Read the current comparison results, including finding ids, values per document with page numbers, reasoning and any overrides.",
    input_schema: {
      type: "object",
      properties: { section: { type: "string", enum: ["overview", "header_fields", "line_items", "checks", "all"] } },
      required: ["section"],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
  {
    name: "update_finding",
    description:
      "Override the status of one finding on the results page (e.g. the user accepts a difference) with a short note explaining why. The results page updates immediately.",
    input_schema: {
      type: "object",
      properties: {
        finding_id: { type: "string", description: "e.g. h3, l12, c2" },
        status: { type: "string", enum: [...STATUSES] },
        note: { type: "string", description: "Why the status changed, in the user's terms" },
      },
      required: ["finding_id", "status", "note"],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
];

const TOOL_LABEL: Record<string, string> = {
  extract_documents: "Reading documents",
  compare_documents: "Comparing documents",
  get_report: "Reviewing results",
  update_finding: "Updating results",
};

type Emit = (e: AgentEvent) => void;

function docLabel(report: Report, ref: string) {
  const d = report.docs.find((x) => x.ref === ref);
  return d ? `${ref} ${DOC_TYPE_SHORT[d.docType as DocType]}${d.subtype ? ` (${d.subtype})` : ""}` : ref;
}

function reportView(report: Report, section: z.infer<typeof ReportInput>["section"]) {
  const r = report.result;
  const fmtValues = (vals: { doc_ref: string; value: string; page: number | null }[]) =>
    vals.map((v) => `${docLabel(report, v.doc_ref)}: ${v.value || "—"}${v.page ? ` (p.${v.page})` : ""}`);
  const ov = (id: string) => report.overrides[id];

  const overview = {
    shipment_ref: r.shipment_ref,
    overall: r.overall,
    summary: r.summary,
    counts: reportCounts(report),
    missing_documents: r.missing_documents,
    documents: report.docs.map((d) => ({ ref: d.ref, type: d.docType, subtype: d.subtype, title: d.title, file: d.fileName })),
  };
  const header = r.header_fields.map((f, i) => {
    const id = findingId("h", i);
    return { id, field: f.label, status: effectiveStatus(report, id, f.status), values: fmtValues(f.values), reasoning: f.reasoning, suggested_action: f.suggested_action, override: ov(id) };
  });
  const lines = r.line_items.map((l, i) => {
    const id = findingId("l", i);
    return {
      id,
      item: l.item_key,
      description: l.description,
      status: effectiveStatus(report, id, l.status),
      cells: l.cells.map((c) => `${docLabel(report, c.doc_ref)}: qty ${c.quantity ?? "—"} ${c.uom ?? ""}, HS ${c.hs_code ?? "—"}, amt ${c.amount ?? "—"}${c.page ? ` (p.${c.page})` : ""}`),
      reasoning: l.reasoning,
      override: ov(id),
    };
  });
  const checks = r.checks.map((c, i) => {
    const id = findingId("c", i);
    return { id, title: c.title, status: effectiveStatus(report, id, c.status), detail: c.detail, override: ov(id) };
  });

  switch (section) {
    case "overview":
      return { ...overview, non_matching: [...header, ...lines, ...checks].filter((x) => x.status !== "match" && x.status !== "single_source") };
    case "header_fields":
      return header;
    case "line_items":
      return lines;
    case "checks":
      return checks;
    default:
      return { ...overview, header_fields: header, line_items: lines, checks };
  }
}

async function runTool(session: Session, block: Anthropic.Beta.BetaToolUseBlock, emit: Emit): Promise<{ content: string; isError?: boolean }> {
  const id = block.id;
  switch (block.name) {
    case "extract_documents": {
      const input = ExtractInput.safeParse(block.input);
      if (!input.success) return { content: "Invalid input: expected {file_ids: string[]}", isError: true };
      const files = input.data.file_ids.map((fid) => store.files.get(fid)).filter((f) => f && f.sessionId === session.id);
      if (files.length === 0) return { content: "None of those file ids belong to this session.", isError: true };
      await Promise.all(
        files.map(async (f) => {
          if (!f || f.extraction) return;
          emit({ type: "tool_progress", id, message: `Reading ${f.name}…` });
          try {
            f.extraction = await extractFile(f);
            f.extractionError = undefined;
            const kinds = f.extraction.documents.map((d) => DOC_TYPE_SHORT[d.doc_type] + (d.doc_subtype ? ` (${d.doc_subtype})` : ""));
            const lines = f.extraction.documents.reduce((n, d) => n + d.line_items.length, 0);
            emit({ type: "tool_progress", id, message: `${f.name}: found ${kinds.join(", ")} · ${lines} line items` });
          } catch (err) {
            f.extractionError = describeApiError(err);
            emit({ type: "tool_progress", id, message: `${f.name}: could not be read — ${f.extractionError}` });
          }
        }),
      );
      return { content: JSON.stringify(files.map((f) => ({ file_id: f!.id, ...summarizeExtraction(f!) }))) };
    }
    case "compare_documents": {
      const input = CompareInput.safeParse(block.input);
      if (!input.success) return { content: "Invalid input: expected {instructions: string|null}", isError: true };
      emit({ type: "tool_progress", id, message: "Matching fields and line items across documents…" });
      try {
        const report = await compareSession(session, input.data.instructions ?? undefined);
        emit({ type: "report", reportId: report.id, shipmentRef: report.result.shipment_ref, overall: report.result.overall, counts: reportCounts(report) });
        return { content: JSON.stringify({ report_published: true, ...reportView(report, "overview") }) };
      } catch (err) {
        return { content: describeApiError(err), isError: true };
      }
    }
    case "get_report": {
      const input = ReportInput.safeParse(block.input);
      const report = session.reportId ? store.reports.get(session.reportId) : undefined;
      if (!report) return { content: "No comparison has been run yet in this session.", isError: true };
      return { content: JSON.stringify(reportView(report, input.success ? input.data.section : "overview")) };
    }
    case "update_finding": {
      const input = UpdateInput.safeParse(block.input);
      if (!input.success) return { content: "Invalid input.", isError: true };
      const report = session.reportId ? store.reports.get(session.reportId) : undefined;
      if (!report) return { content: "No comparison has been run yet.", isError: true };
      const { finding_id, status, note } = input.data;
      const m = /^([hlc])(\d+)$/.exec(finding_id);
      const list = m && { h: report.result.header_fields, l: report.result.line_items, c: report.result.checks }[m[1] as "h" | "l" | "c"];
      const item = m && list ? list[Number(m[2]) - 1] : undefined;
      if (!item) return { content: `Unknown finding id ${finding_id}.`, isError: true };
      report.overrides[finding_id] = { status, note, by: "agent", at: Date.now(), previousStatus: effectiveStatus(report, finding_id, item.status) };
      report.updatedAt = Date.now();
      emit({ type: "report", reportId: report.id, shipmentRef: report.result.shipment_ref, overall: report.result.overall, counts: reportCounts(report) });
      return { content: JSON.stringify({ updated: finding_id, status, counts: reportCounts(report) }) };
    }
    default:
      return { content: `Unknown tool ${block.name}`, isError: true };
  }
}

function toolEndSummary(name: string, session: Session, ok: boolean): string {
  if (!ok) return "Failed";
  if (name === "extract_documents") {
    const n = session.fileIds.map((f) => store.files.get(f)?.extraction?.documents.length ?? 0).reduce((a, b) => a + b, 0);
    return `${n} documents read`;
  }
  if (name === "compare_documents") {
    const r = session.reportId ? store.reports.get(session.reportId) : undefined;
    if (!r) return "Done";
    const c = reportCounts(r);
    return `${c.mismatch} mismatch · ${c.minor} minor · ${c.match} match`;
  }
  if (name === "update_finding") return "Results page updated";
  return "Done";
}

/** Runs one user turn of the agent, streaming events. */
export async function runAgentTurn(session: Session, userText: string, newFileIds: string[], emit: Emit) {
  const fileLines = newFileIds
    .map((id) => store.files.get(id))
    .filter(Boolean)
    .map((f) => `- ${f!.id}: "${f!.name}" (${Math.round(f!.size / 1024)} KB, ${f!.mediaType})`);
  const notes = session.pendingNotes.splice(0);
  const text = [notes.join("\n"), userText.trim(), fileLines.length ? `[Uploaded files]\n${fileLines.join("\n")}` : ""]
    .filter(Boolean)
    .join("\n\n");
  session.messages.push({ role: "user", content: text || "(no message)" });

  for (let turn = 0; turn < 20; turn++) {
    const stream = client().beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages: session.messages,
    });
    stream.on("text", (delta) => emit({ type: "text", delta }));

    let msg: Anthropic.Beta.BetaMessage;
    try {
      msg = await stream.finalMessage();
    } catch (err) {
      // Drop the dangling user turn on hard API failure so the session stays usable.
      if (turn === 0) session.messages.pop();
      emit({ type: "error", message: describeApiError(err) });
      return;
    }

    session.messages.push({ role: "assistant", content: msg.content });

    if (msg.stop_reason === "refusal") {
      emit({ type: "error", message: "The assistant declined this request." });
      return;
    }
    if (msg.stop_reason === "pause_turn") continue;

    const toolUses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (msg.stop_reason !== "tool_use" || toolUses.length === 0) return;

    const results = await Promise.all(
      toolUses.map(async (tu) => {
        emit({ type: "tool_start", id: tu.id, name: tu.name, label: TOOL_LABEL[tu.name] ?? tu.name });
        const r = await runTool(session, tu, emit);
        emit({ type: "tool_end", id: tu.id, ok: !r.isError, summary: toolEndSummary(tu.name, session, !r.isError) });
        return { type: "tool_result" as const, tool_use_id: tu.id, content: r.content, is_error: r.isError };
      }),
    );
    session.messages.push({ role: "user", content: results });
  }
}
