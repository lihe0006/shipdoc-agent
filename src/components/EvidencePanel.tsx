"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Maximize2, Minimize2, X, ZoomIn, ZoomOut } from "lucide-react";
import type { Status } from "@/lib/schemas";
import type { DocRef } from "@/lib/store";
import { DOC_TYPE_LABEL, type DocType } from "@/lib/fields";
import { STATUS_LABEL } from "@/lib/ui";
import { loadImage, loadPdf, locateInImage, locateInPdf, renderPdfPage, type Box, type LocateResult, type Target } from "@/lib/pdfLocate";
import s from "./evidence.module.css";

export type EvidenceItem = {
  doc: DocRef;
  value: string;
  sub?: string | null;
  page: number | null;
  quote: string | null;
  target: Target;
};

export type Evidence = {
  /** Changes whenever the user opens the panel (used to re-scroll). */
  key: string;
  title: string;
  subtitle: string;
  status: Status;
  reasoning: string;
  items: EvidenceItem[];
  focusRef?: string;
};

export default function EvidencePanel({ ev, onClose }: { ev: Evidence; onClose: () => void }) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ev.focusRef) {
      listRef.current?.scrollTo({ top: 0 });
      return;
    }
    const el = listRef.current?.querySelector(`[data-ref="${ev.focusRef}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [ev.key, ev.focusRef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = ev.items.filter((i) => i.value);
  const notShown = ev.items.filter((i) => !i.value);

  return (
    <aside className={`${s.panel} noprint`} aria-label="Source preview">
      <div className={s.head}>
        <div className={s.headText}>
          <div className={s.title}>{ev.title}</div>
          <div className={s.subtitle}>{ev.subtitle}</div>
        </div>
        <span className={`pill pill--${ev.status}`}>{STATUS_LABEL[ev.status]}</span>
        <button className="btn btn--ghost" onClick={onClose} aria-label="Close preview">
          <X size={16} />
        </button>
      </div>
      <div className={s.list} ref={listRef}>
        {ev.reasoning && <div className={s.reasoning}>{ev.reasoning}</div>}
        {shown.map((it) => (
          <DocCard key={`${ev.title}:${it.doc.ref}`} item={it} focused={ev.focusRef === it.doc.ref} />
        ))}
        {notShown.length > 0 && (
          <div className={s.notShown}>
            Not shown on: {notShown.map((i) => `${i.doc.ref} ${DOC_TYPE_LABEL[i.doc.docType as DocType]}`).join(", ")}
          </div>
        )}
        {!shown.length && <div className={s.notShown}>No document shows a value for this field.</div>}
      </div>
    </aside>
  );
}

const ZOOMS = [1, 1.5, 2.25];

function DocCard({ item, focused }: { item: EvidenceItem; focused: boolean }) {
  const { doc } = item;
  const isPdf = !/\.(png|jpe?g|webp)$/i.test(doc.fileName);
  const viewerRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [phase, setPhase] = useState<"loading" | "locating" | "done" | "error">("loading");
  const [res, setRes] = useState<LocateResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // Primitive keys so the 4-second report refresh doesn't re-run location.
  const targetKey = JSON.stringify(item.target);
  const pagesKey = doc.pages.join(",");

  // Locate once per item.
  useEffect(() => {
    let off = false;
    setPhase("loading");
    setRes(null);
    (async () => {
      // Show the hinted page straight away, then locate.
      setPhase("locating");
      const target = JSON.parse(targetKey) as Target;
      const pages = pagesKey ? pagesKey.split(",").map(Number) : [];
      const r = isPdf ? await locateInPdf(doc.fileId, item.page, target, pages) : await locateInImage(doc.fileId, target);
      if (!off) {
        setRes(r);
        setPhase("done");
      }
    })().catch((e) => {
      if (!off) {
        setErr(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    });
    return () => {
      off = true;
    };
  }, [doc.fileId, pagesKey, isPdf, item.page, targetKey]);

  const pageNo = res?.page ?? item.page ?? doc.pages[0] ?? 1;

  // Render the page (re-render on page or zoom change).
  useEffect(() => {
    let off = false;
    const holder = holderRef.current;
    const viewer = viewerRef.current;
    if (!holder || !viewer) return;
    const width = Math.max(240, viewer.clientWidth - 2) * zoom;
    (async () => {
      const canvas = document.createElement("canvas");
      if (isPdf) {
        const pdf = await loadPdf(doc.fileId);
        await renderPdfPage(await pdf.getPage(Math.min(pageNo, pdf.numPages)), canvas, width);
      } else {
        const img = await loadImage(doc.fileId);
        const h = (width * img.naturalHeight) / img.naturalWidth;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${h}px`;
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      if (off) return;
      holder.replaceChildren(canvas);
      setSize({ w: parseFloat(canvas.style.width), h: parseFloat(canvas.style.height) });
    })().catch((e) => !off && (setErr(e instanceof Error ? e.message : String(e)), setPhase("error")));
    return () => {
      off = true;
    };
  }, [doc.fileId, isPdf, pageNo, zoom]);

  // Centre the first highlight in the viewer.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !size || !res?.boxes.length) return;
    const b = res.boxes[0];
    const cx = ((b.x0 + b.x1) / 2) * size.w;
    const cy = ((b.y0 + b.y1) / 2) * size.h;
    viewer.scrollTo({ left: Math.max(0, cx - viewer.clientWidth / 2), top: Math.max(0, cy - viewer.clientHeight / 2), behavior: "smooth" });
  }, [res, size, expanded]);

  const status =
    phase === "error"
      ? { tone: "bad", text: err ?? "Could not load the page" }
      : phase !== "done"
        ? { tone: "busy", text: isPdf ? "Finding the value on the page…" : "Finding the value on the image…" }
        : res?.method === "text"
          ? { tone: "ok", text: `Highlighted on page ${pageNo}` }
          : res?.method === "vision"
            ? { tone: "ok", text: `Located by AI on page ${pageNo} (approximate position)` }
            : { tone: "warn", text: res?.error ? `Could not highlight: ${res.error}` : `Exact position not found. Showing page ${pageNo}.` };

  return (
    <section className={`${s.card} ${focused ? s.cardFocused : ""}`} data-ref={doc.ref}>
      <div className={s.cardHead}>
        <span className={s.docRef}>{doc.ref}</span>
        <div className={s.cardTitle}>
          <div>
            {DOC_TYPE_LABEL[doc.docType as DocType]}
            {doc.subtype ? ` · ${doc.subtype}` : ""}
          </div>
          <div className={s.cardFile} title={doc.fileName}>
            {doc.fileName} · page {pageNo}
          </div>
        </div>
        <a className="btn btn--ghost" href={`/api/files/${doc.fileId}${isPdf ? `#page=${pageNo}` : ""}`} target="_blank" rel="noreferrer" title="Open the full file in a new tab">
          <ExternalLink size={14} />
        </a>
      </div>
      <div className={s.valueRow}>
        <div className={s.value}>{item.value}</div>
        {item.sub && <div className={s.sub}>{item.sub}</div>}
        {item.quote && item.quote !== item.value && <div className={s.quote}>&ldquo;{item.quote}&rdquo;</div>}
      </div>
      <div className={s.viewerBar}>
        <span className={`${s.state} ${s[`state_${status.tone}`]}`}>
          {status.tone === "busy" && <span className="spinner" style={{ width: 12, height: 12 }} />}
          {status.text}
        </span>
        <div className={s.tools}>
          <button className={s.tool} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])} disabled={zoom === ZOOMS[0]} aria-label="Zoom out">
            <ZoomOut size={14} />
          </button>
          <span className={s.zoomLabel}>{Math.round(zoom * 100)}%</span>
          <button className={s.tool} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])} disabled={zoom === ZOOMS[ZOOMS.length - 1]} aria-label="Zoom in">
            <ZoomIn size={14} />
          </button>
          <button className={s.tool} onClick={() => setExpanded(!expanded)} aria-label={expanded ? "Collapse" : "Expand"} title={expanded ? "Collapse" : "Show the whole page"}>
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>
      <div className={`${s.viewer} ${expanded ? s.viewerExpanded : ""}`} ref={viewerRef}>
        <div className={s.page} style={size ? { width: size.w, height: size.h } : undefined}>
          <div ref={holderRef} />
          {size && res?.boxes.map((b, i) => <Highlight key={i} b={b} vision={res.method === "vision"} />)}
          {!size && <div className={s.pagePlaceholder} />}
        </div>
      </div>
    </section>
  );
}

function Highlight({ b, vision }: { b: Box; vision: boolean }) {
  const pad = vision ? 0.006 : 0.003;
  return (
    <div
      className={s.hl}
      style={{
        left: `${(b.x0 - pad) * 100}%`,
        top: `${(b.y0 - pad) * 100}%`,
        width: `${(b.x1 - b.x0 + pad * 2) * 100}%`,
        height: `${(b.y1 - b.y0 + pad * 2) * 100}%`,
      }}
    />
  );
}
