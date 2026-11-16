"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Download, FileText, Minus, Printer, Search, Sparkles, X } from "lucide-react";
import type { ComparisonResult, Status } from "@/lib/schemas";
import type { Report } from "@/lib/store";
import { DOC_TYPE_LABEL, DOC_TYPE_SHORT, type DocType } from "@/lib/fields";
import { STATUS_LABEL } from "@/lib/ui";
import EvidencePanel, { type Evidence } from "@/components/EvidencePanel";
import s from "./report.module.css";

type ReportDTO = Report & { counts: Record<Status, number> };
type Tab = "fields" | "lines" | "checks";
type Pick = { kind: "field" | "line"; idx: number; focusRef?: string; n: number };
type Source = { fileId: string; docRef: string; page: number | null; quote: string | null; value: string; field: string };

const FILTERS: (Status | "all")[] = ["all", "mismatch", "minor", "missing", "match", "single_source"];

export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [report, setReport] = useState<ReportDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("fields");
  const [filter, setFilter] = useState<Status | "all">("all");
  const [q, setQ] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [pick, setPick] = useState<Pick | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/reports/${id}`, { cache: "no-store" });
    if (r.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent(`/reports/${id}`)}`;
      return;
    }
    const j = await r.json();
    if (!r.ok) setError(j.error ?? "Could not load the report");
    else {
      setReport(j);
      setError(null);
    }
  }, [id]);

  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  const override = async (findingId: string, status: Status | null) => {
    const note = status ? window.prompt("Note for this change (optional)", "") ?? "" : "";
    const r = await fetch(`/api/reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ findingId, status, note }),
    });
    if (r.ok) setReport(await r.json());
  };

  if (error)
    return (
      <div className={s.center}>
        <AlertCircle size={20} color="var(--danger)" /> {error}
      </div>
    );
  if (!report)
    return (
      <div className={s.center}>
        <span className="spinner" /> Loading results…
      </div>
    );

  const r = report.result;
  const st = (fid: string, orig: Status) => report.overrides[fid]?.status ?? orig;
  const docByRef = Object.fromEntries(report.docs.map((d) => [d.ref, d]));
  const total = Object.values(report.counts).reduce((a, b) => a + b, 0);
  const verdict = r.overall === "mismatch" ? "Mismatches found" : r.overall === "review" ? "Needs review" : "All clear";
  const verdictTone: Status = r.overall === "mismatch" ? "mismatch" : r.overall === "review" ? "minor" : "match";

  const openSource = (docRef: string, page: number | null, quote: string | null, value: string, field: string) => {
    const d = docByRef[docRef];
    if (d) {
      setPick(null);
      setSource({ fileId: d.fileId, docRef, page, quote, value, field });
    }
  };
  const openField = (idx: number, focusRef?: string) => {
    setSource(null);
    setPick((p) => ({ kind: "field", idx, focusRef, n: (p?.n ?? 0) + 1 }));
  };
  const openLine = (idx: number, focusRef?: string) => {
    setSource(null);
    setPick((p) => ({ kind: "line", idx, focusRef, n: (p?.n ?? 0) + 1 }));
  };
  const evidence = pick ? buildEvidence(report, pick, st) : null;

  return (
    <div className={s.app}>
      <div className={s.main}>
        <header className={s.header}>
          <div className={s.headerLeft}>
            <h1 className={s.title}>Document check</h1>
            <span className={s.ref}>{r.shipment_ref}</span>
            <span className={`pill pill--${verdictTone}`}>{verdict}</span>
          </div>
          <div className={`${s.actions} noprint`}>
            <a className="btn" href={`/api/reports/${id}/xlsx`}>
              <Download size={14} /> Export Excel
            </a>
            <button className="btn" onClick={() => window.print()}>
              <Printer size={14} /> Export PDF
            </button>
          </div>
        </header>

        <section className={s.summary}>
          <div className={s.summaryIcon}>
            <Sparkles size={16} />
          </div>
          <div className={s.summaryBody}>
            <p className={summaryOpen ? "" : s.clamp}>{r.summary}</p>
            <button className={`${s.more} noprint`} onClick={() => setSummaryOpen(!summaryOpen)}>
              {summaryOpen ? "Show less" : "Show more"}
            </button>
            <div className={s.docChips}>
              {report.docs.map((d) => (
                <button key={d.ref} className={s.docChip} onClick={() => openSource(d.ref, d.pages[0] ?? 1, null, "", d.title)} title={d.fileName}>
                  <span className={s.docRef}>{d.ref}</span>
                  {DOC_TYPE_LABEL[d.docType as DocType]}
                  {d.subtype ? ` · ${d.subtype}` : ""}
                  <span className="muted">— {d.title}</span>
                </button>
              ))}
              {r.missing_documents.map((m) => (
                <span key={m} className="pill pill--missing">
                  Not uploaded: {m}
                </span>
              ))}
            </div>
          </div>
        </section>

        <div className={`${s.stats} noprint`}>
          {FILTERS.map((f) => (
            <button key={f} className={`${s.stat} ${filter === f ? s.statActive : ""}`} onClick={() => setFilter(filter === f && f !== "all" ? "all" : f)}>
              <span className={s.statLabel}>
                {f !== "all" && <span className={`${s.statDot} ${s[`dot_${f}`]}`} />}
                {f === "all" ? "All findings" : STATUS_LABEL[f]}
              </span>
              <span className={s.statValue}>{f === "all" ? total : report.counts[f]}</span>
            </button>
          ))}
        </div>

        <div className={`${s.toolbar} noprint`}>
          <div className={s.tabs} role="tablist">
            {(
              [
                ["fields", `Data fields (${r.header_fields.length})`],
                ["lines", `Line items (${r.line_items.length})`],
                ["checks", `Consistency checks (${r.checks.length})`],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={`${s.tab} ${tab === k ? s.tabActive : ""}`} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>
          <label className={s.search}>
            <Search size={15} className="muted" />
            <input placeholder="Search fields, values, items…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>

        <div className={s.tableWrap}>
          <div className={tab === "fields" ? "" : s.hiddenScreen}>
            <h2 className={s.printTitle}>Data fields</h2>
            <FieldsTable report={report} r={r} st={st} filter={filter} q={q} open={openField} selected={pick?.kind === "field" ? pick.idx : null} override={override} />
          </div>
          <div className={tab === "lines" ? "" : s.hiddenScreen}>
            <h2 className={s.printTitle}>Line items</h2>
            <LinesTable report={report} r={r} st={st} filter={filter} q={q} open={openLine} selected={pick?.kind === "line" ? pick.idx : null} override={override} />
          </div>
          <div className={tab === "checks" ? "" : s.hiddenScreen}>
            <h2 className={s.printTitle}>Consistency checks</h2>
            <ChecksTable report={report} r={r} st={st} filter={filter} q={q} override={override} />
          </div>
        </div>
      </div>

      {source && <SourcePanel source={source} report={report} onClose={() => setSource(null)} />}
      {evidence && <EvidencePanel ev={evidence} onClose={() => setPick(null)} />}
    </div>
  );
}

// ── Shared bits ──

function StatusCell({ status, override }: { status: Status; override?: Report["overrides"][string] }) {
  const glyph = status === "match" ? <Check size={10} strokeWidth={3.5} /> : status === "single_source" ? <Minus size={10} strokeWidth={3.5} /> : status === "minor" ? "!" : status === "missing" ? "?" : <X size={10} strokeWidth={3.5} />;
  return (
    <div>
      <span className={`status status--${status}`}>
        <span className="status__dot" style={{ fontSize: 10, fontWeight: 700 }}>
          {glyph}
        </span>
        {STATUS_LABEL[status]}
      </span>
      {override && (
        <div className={s.override}>
          {override.by === "user" ? "Reviewer" : "Agent"} changed from {STATUS_LABEL[override.previousStatus].toLowerCase()}
          {override.note ? `: ${override.note}` : ""}
        </div>
      )}
    </div>
  );
}

function OverrideMenu({ fid, current, hasOverride, onChange }: { fid: string; current: Status; hasOverride: boolean; onChange: (fid: string, s: Status | null) => void }) {
  return (
    <select
      className={`${s.overrideSelect} noprint`}
      onClick={(e) => e.stopPropagation()}
      value=""
      aria-label="Change status"
      onChange={(e) => {
        const v = e.target.value;
        if (v === "reset") onChange(fid, null);
        else if (v) onChange(fid, v as Status);
      }}
    >
      <option value="">Change…</option>
      {(["match", "minor", "mismatch"] as Status[])
        .filter((x) => x !== current)
        .map((x) => (
          <option key={x} value={x}>
            Mark as {STATUS_LABEL[x].toLowerCase()}
          </option>
        ))}
      {hasOverride && <option value="reset">Reset to agent verdict</option>}
    </select>
  );
}

function DocHead({ report, docRef }: { report: Report; docRef: string }) {
  const d = report.docs.find((x) => x.ref === docRef);
  if (!d) return <>{docRef}</>;
  return (
    <div>
      <div>
        <span className={s.docRef}>{d.ref}</span> {DOC_TYPE_SHORT[d.docType as DocType]}
        {d.subtype ? ` · ${d.subtype}` : ""}
      </div>
      <div className={s.docHeadSub} title={d.fileName}>
        {d.docNumber ?? d.title}
      </div>
    </div>
  );
}

function PageLink({ page, onClick }: { page: number | null; onClick: () => void }) {
  if (!page) return null;
  return (
    <button
      className={`${s.pageLink} noprint-inline`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title="Show highlighted in the source documents"
    >
      p.{page}
    </button>
  );
}

const matches = (q: string, ...parts: (string | number | null | undefined)[]) =>
  !q || parts.some((p) => p != null && String(p).toLowerCase().includes(q.toLowerCase()));

type CommonProps = {
  report: ReportDTO;
  r: ComparisonResult;
  st: (fid: string, s: Status) => Status;
  filter: Status | "all";
  q: string;
  override: (fid: string, s: Status | null) => void;
};
type RowOpen = { open: (idx: number, focusRef?: string) => void; selected: number | null };

function Empty() {
  return <div className={s.empty}>No findings match this filter.</div>;
}

// ── Data fields ──

function FieldsTable({ report, r, st, filter, q, open, selected, override }: CommonProps & RowOpen) {
  const refs = report.docs.map((d) => d.ref);
  const rows = useMemo(
    () =>
      r.header_fields
        .map((f, i) => ({ f, i, fid: `h${i + 1}` }))
        .filter(({ f, fid }) => (filter === "all" || st(fid, f.status) === filter) && matches(q, f.label, f.category, f.reasoning, ...f.values.map((v) => v.value))),
    [r, filter, q, st],
  );
  if (!rows.length) return <Empty />;
  return (
    <table className={s.table}>
      <thead>
        <tr>
          <th className={`${s.stickyA} ${s.colStatus}`}>Status</th>
          <th className={`${s.stickyB} ${s.colField}`}>Field</th>
          {refs.map((ref) => (
            <th key={ref} className={s.colDoc}>
              <DocHead report={report} docRef={ref} />
            </th>
          ))}
          <th className={s.colReason}>Agent reasoning</th>
          <th className={`${s.colAction} noprint`} />
        </tr>
      </thead>
      <tbody>
        {rows.map(({ f, i, fid }) => {
          const status = st(fid, f.status);
          return (
            <tr key={fid} className={`${s[`row_${status}`]} ${s.clickRow} ${selected === i ? s.rowSelected : ""}`} onClick={() => open(i)} title="Show this field in all documents">
              <td className={s.stickyA}>
                <StatusCell status={status} override={report.overrides[fid]} />
              </td>
              <td className={s.stickyB}>
                <div className={s.fieldLabel}>{f.label}</div>
                <div className={s.fieldCat}>
                  {f.category} · {fid}
                </div>
              </td>
              {refs.map((ref) => {
                const v = f.values.find((x) => x.doc_ref === ref);
                if (!v) return <td key={ref} className={s.na}>—</td>;
                return (
                  <td key={ref} className={!v.value ? s.absent : ""}>
                    <div className={s.value}>{v.value || "Not shown"}</div>
                    <PageLink page={v.page} onClick={() => open(i, ref)} />
                  </td>
                );
              })}
              <td className={s.reason}>
                {f.reasoning}
                {f.suggested_action && status !== "match" && <div className={s.action}>→ {f.suggested_action}</div>}
              </td>
              <td className="noprint">
                <OverrideMenu fid={fid} current={status} hasOverride={!!report.overrides[fid]} onChange={override} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Line items ──

function LinesTable({ report, r, st, filter, q, open, selected, override }: CommonProps & RowOpen) {
  const refs = report.docs.map((d) => d.ref).filter((ref) => r.line_items.some((l) => l.cells.some((c) => c.doc_ref === ref)));
  const rows = r.line_items
    .map((l, i) => ({ l, i, fid: `l${i + 1}` }))
    .filter(({ l, fid }) => (filter === "all" || st(fid, l.status) === filter) && matches(q, l.item_key, l.description, l.reasoning, ...l.cells.map((c) => c.hs_code)));
  if (!rows.length) return <Empty />;
  return (
    <table className={s.table}>
      <thead>
        <tr>
          <th className={`${s.stickyA} ${s.colStatus}`}>Status</th>
          <th className={`${s.stickyB} ${s.colField}`}>Item</th>
          {refs.map((ref) => (
            <th key={ref} className={s.colDocNarrow}>
              <DocHead report={report} docRef={ref} />
            </th>
          ))}
          <th className={s.colReason}>Agent reasoning</th>
          <th className={`${s.colAction} noprint`} />
        </tr>
      </thead>
      <tbody>
        {rows.map(({ l, i, fid }) => {
          const status = st(fid, l.status);
          return (
            <tr key={fid} className={`${s[`row_${status}`]} ${s.clickRow} ${selected === i ? s.rowSelected : ""}`} onClick={() => open(i)} title="Show this item in all documents">
              <td className={s.stickyA}>
                <StatusCell status={status} override={report.overrides[fid]} />
              </td>
              <td className={s.stickyB}>
                <div className={s.fieldLabel}>{l.item_key}</div>
                <div className={s.fieldCat}>{l.description}</div>
              </td>
              {refs.map((ref) => {
                const c = l.cells.find((x) => x.doc_ref === ref);
                if (!c) return <td key={ref} className={s.absent}>Not listed</td>;
                return (
                  <td key={ref}>
                    <div className={`${s.value} mono-num`}>
                      {c.quantity ?? "—"} {c.uom ?? ""}
                      {c.amount != null && <span className="muted"> · {c.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>}
                    </div>
                    {c.hs_code && <div className={s.sub}>HS {c.hs_code}</div>}
                    <PageLink page={c.page} onClick={() => open(i, ref)} />
                  </td>
                );
              })}
              <td className={s.reason}>{l.reasoning}</td>
              <td className="noprint">
                <OverrideMenu fid={fid} current={status} hasOverride={!!report.overrides[fid]} onChange={override} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Checks ──

function ChecksTable({ report, r, st, filter, q, override }: CommonProps) {
  const rows = r.checks
    .map((c, i) => ({ c, fid: `c${i + 1}` }))
    .filter(({ c, fid }) => (filter === "all" || st(fid, c.status) === filter) && matches(q, c.title, c.detail));
  if (!rows.length) return <Empty />;
  return (
    <table className={s.table}>
      <thead>
        <tr>
          <th className={`${s.stickyA} ${s.colStatus}`}>Status</th>
          <th className={s.colCheck}>Check</th>
          <th>Detail</th>
          <th className={s.colDocsUsed}>Documents</th>
          <th className={`${s.colAction} noprint`} />
        </tr>
      </thead>
      <tbody>
        {rows.map(({ c, fid }) => {
          const status = st(fid, c.status);
          return (
            <tr key={fid} className={s[`row_${status}`]}>
              <td className={s.stickyA}>
                <StatusCell status={status} override={report.overrides[fid]} />
              </td>
              <td>
                <div className={s.fieldLabel}>{c.title}</div>
                <div className={s.fieldCat}>{fid}</div>
              </td>
              <td className={s.reason}>{c.detail}</td>
              <td className={s.sub}>{c.doc_refs.join(", ")}</td>
              <td className="noprint">
                <OverrideMenu fid={fid} current={status} hasOverride={!!report.overrides[fid]} onChange={override} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Source viewer ──

function SourcePanel({ source, report, onClose }: { source: Source; report: Report; onClose: () => void }) {
  const d = report.docs.find((x) => x.ref === source.docRef)!;
  const isPdf = !/\.(png|jpe?g|webp)$/i.test(d.fileName);
  const src = `/api/files/${source.fileId}${isPdf ? `#page=${source.page ?? 1}&navpanes=0&view=FitH` : ""}`;
  return (
    <aside className={`${s.panel} noprint`}>
      <div className={s.panelHead}>
        <FileText size={16} className="muted" />
        <div className={s.panelTitle}>
          <div>
            {d.ref} · {DOC_TYPE_LABEL[d.docType as DocType]}
            {d.subtype ? ` · ${d.subtype}` : ""}
          </div>
          <div className={s.docHeadSub}>
            {d.fileName}
            {source.page ? ` · page ${source.page}` : ""}
          </div>
        </div>
        <button className="btn btn--ghost" onClick={onClose} aria-label="Close source">
          <X size={16} />
        </button>
      </div>
      {(source.value || source.quote) && (
        <div className={s.quote}>
          <div className={s.quoteField}>{source.field}</div>
          {source.value && <div className={s.quoteValue}>{source.value}</div>}
          {source.quote && <div className={s.quoteText}>&ldquo;{source.quote}&rdquo;</div>}
        </div>
      )}
      {isPdf ? (
        <iframe key={src} className={s.frame} src={src} title="Source document" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={s.frame} src={src} alt={d.fileName} style={{ objectFit: "contain" }} />
      )}
    </aside>
  );
}

// ── Evidence (row click → every document, value highlighted) ──

function buildEvidence(report: ReportDTO, pick: Pick, st: (fid: string, s: Status) => Status): Evidence | null {
  const r = report.result;
  const docByRef = new Map(report.docs.map((d) => [d.ref, d]));
  const key = `${pick.kind}:${pick.idx}:${pick.focusRef ?? ""}:${pick.n}`;
  if (pick.kind === "field") {
    const f = r.header_fields[pick.idx];
    if (!f) return null;
    return {
      key,
      title: f.label,
      subtitle: `${f.category} · h${pick.idx + 1} · ${f.values.filter((v) => v.value).length} documents`,
      status: st(`h${pick.idx + 1}`, f.status),
      reasoning: f.reasoning,
      focusRef: pick.focusRef,
      items: report.docs
        .map((d) => ({ d, v: f.values.find((v) => v.doc_ref === d.ref) }))
        .filter((x) => x.v)
        .map(({ d, v }) => ({
          doc: d,
          value: v!.value,
          page: v!.page,
          quote: v!.source_text,
          target: { label: f.label, value: v!.value, context: v!.source_text },
        })),
    };
  }
  const l = r.line_items[pick.idx];
  if (!l) return null;
  return {
    key,
    title: l.item_key,
    subtitle: `Line item · l${pick.idx + 1} · ${l.cells.length} documents`,
    status: st(`l${pick.idx + 1}`, l.status),
    reasoning: l.reasoning,
    focusRef: pick.focusRef,
    items: l.cells
      .filter((c) => docByRef.has(c.doc_ref))
      .map((c) => {
        const qty = [c.quantity, c.uom].filter((x) => x != null && x !== "").join(" ");
        const amt = c.amount != null ? c.amount.toLocaleString("en-US", { minimumFractionDigits: 2 }) : null;
        const desc = c.description || l.description;
        return {
          doc: docByRef.get(c.doc_ref)!,
          value: desc,
          sub: [qty && `Qty ${qty}`, amt && `Amount ${amt}`, c.hs_code && `HS ${c.hs_code}`, c.line_no != null && `Line ${c.line_no}`].filter(Boolean).join(" · "),
          page: c.page,
          quote: null,
          target: {
            label: `Line item ${l.item_key}`,
            value: desc,
            context: [l.item_key, c.hs_code && `HS ${c.hs_code}`, qty && `quantity ${qty}`, amt && `amount ${amt}`].filter(Boolean).join(", "),
            // Item code only: HS codes repeat across rows and would light up every line.
            extra: [l.item_key].filter((x) => x.replace(/[^a-z0-9]/gi, "").length >= 5),
          },
        };
      }),
  };
}
