"use client";

/**
 * Browser-side page rendering and value location.
 * 1. Digital PDFs: search the page's text layer (pdf.js) for the value.
 * 2. Scanned PDFs / images, or when the text search finds nothing: send the
 *    rendered page to /api/locate, where Claude returns boxes on the image.
 * Boxes are fractions (0–1) of the page width/height.
 */

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Target = { label: string; value: string; context: string | null; extra?: string[] };
export type LocateResult = { page: number; boxes: Box[]; method: "text" | "vision" | "none"; error?: string };

type PdfJs = typeof import("pdfjs-dist");
let lib: Promise<PdfJs> | null = null;
function pdfjs(): Promise<PdfJs> {
  return (lib ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
    const mod = m as unknown as PdfJs;
    mod.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
    return mod;
  }));
}

const docs = new Map<string, Promise<PDFDocumentProxy>>();
export function loadPdf(fileId: string) {
  let p = docs.get(fileId);
  if (!p) {
    p = pdfjs().then((m) => m.getDocument({ url: `/api/files/${fileId}` }).promise);
    p.catch(() => docs.delete(fileId));
    docs.set(fileId, p);
  }
  return p;
}

const images = new Map<string, Promise<HTMLImageElement>>();
export function loadImage(fileId: string) {
  let p = images.get(fileId);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load image"));
      img.src = `/api/files/${fileId}`;
    });
    p.catch(() => images.delete(fileId));
    images.set(fileId, p);
  }
  return p;
}

/** Render a PDF page into a canvas at the given CSS width. */
export async function renderPdfPage(page: PDFPageProxy, canvas: HTMLCanvasElement, cssWidth: number) {
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = page.getViewport({ scale: scale * dpr });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${(cssWidth * base.height) / base.width}px`;
  await page.render({ canvas, viewport: vp }).promise;
}

// ── Text-layer search ──

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type TextIndex = { s: string; map: { item: number; ch: number }[]; items: { str: string; x: number; y: number; w: number; h: number }[]; chars: number };
const textCache = new Map<string, Promise<TextIndex>>();

async function textIndex(fileId: string, page: PDFPageProxy): Promise<TextIndex> {
  const key = `${fileId}:${page.pageNumber}`;
  let p = textCache.get(key);
  if (!p) {
    p = (async () => {
      const m = await pdfjs();
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items: TextIndex["items"] = [];
      const map: TextIndex["map"] = [];
      let s = "";
      let chars = 0;
      for (const it of tc.items) {
        if (!("str" in it) || !it.str) continue;
        const tx = m.Util.transform(vp.transform, it.transform);
        const h = Math.hypot(tx[2], tx[3]);
        const idx = items.length;
        items.push({ str: it.str, x: tx[4] / vp.width, y: (tx[5] - h) / vp.height, w: it.width / vp.width, h: (h * 1.2) / vp.height });
        chars += it.str.trim().length;
        for (let c = 0; c < it.str.length; c++) {
          const n = norm(it.str[c]);
          if (n) {
            s += n;
            map.push({ item: idx, ch: c });
          }
        }
      }
      return { s, map, items, chars };
    })();
    textCache.set(key, p);
  }
  return p;
}

function findAll(ix: TextIndex, needle: string, limit = 6): Box[] {
  const n = norm(needle);
  if (n.length < 3) return [];
  const boxes: Box[] = [];
  let from = 0;
  while (boxes.length < limit) {
    const at = ix.s.indexOf(n, from);
    if (at < 0) break;
    from = at + n.length;
    // Group matched characters by text item, then box the matched part of each item.
    const spans = new Map<number, { a: number; b: number }>();
    for (let k = at; k < at + n.length; k++) {
      const { item, ch } = ix.map[k];
      const sp = spans.get(item);
      if (sp) sp.b = ch + 1;
      else spans.set(item, { a: ch, b: ch + 1 });
    }
    for (const [item, { a, b }] of spans) {
      const it = ix.items[item];
      const L = it.str.length || 1;
      boxes.push({ x0: it.x + (it.w * a) / L, y0: it.y, x1: it.x + (it.w * b) / L, y1: it.y + it.h });
    }
  }
  return boxes;
}

function segments(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(/\n|;|,(?=\s)|\s{2,}|\s[|/]\s/)
    .map((x) => x.trim())
    .filter((x) => norm(x).length >= 4);
}

function searchText(ix: TextIndex, t: Target): Box[] {
  const v = t.value?.trim() ?? "";
  const ordered = norm(v).length >= 6 ? [v, t.context] : [t.context, v];
  for (const cand of ordered) {
    if (!cand) continue;
    const hit = findAll(ix, cand, 3);
    if (hit.length) return [...hit, ...(t.extra ?? []).flatMap((e) => findAll(ix, e, 2))];
  }
  // Fall back to matching pieces (address lines, "vessel / voyage" parts…).
  const parts = [...new Set([...segments(v), ...segments(t.context)])];
  const hits = parts.flatMap((p) => findAll(ix, p, 2));
  if (hits.length) return [...hits, ...(t.extra ?? []).flatMap((e) => findAll(ix, e, 2))];
  return (t.extra ?? []).flatMap((e) => (norm(e).length >= 5 ? findAll(ix, e, 2) : []));
}

// ── Vision fallback ──

const visionCache = new Map<string, Promise<Box[]>>();

async function locateByVision(fileId: string, page: number, source: HTMLCanvasElement | HTMLImageElement, t: Target): Promise<Box[]> {
  const key = JSON.stringify([fileId, page, t.label, t.value, t.context]);
  let p = visionCache.get(key);
  if (!p) {
    p = (async () => {
      const sw = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
      const sh = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
      const k = Math.min(1, 1568 / Math.max(sw, sh));
      const c = document.createElement("canvas");
      c.width = Math.round(sw * k);
      c.height = Math.round(sh * k);
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(source, 0, 0, c.width, c.height);
      const res = await fetch("/api/locate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, page, image: c.toDataURL("image/jpeg", 0.85), width: c.width, height: c.height, label: t.label, value: t.value, context: t.context }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `Locate failed (${res.status})`);
      return j.boxes as Box[];
    })();
    p.catch(() => visionCache.delete(key));
    visionCache.set(key, p);
  }
  return p;
}

/** Hi-res render of a PDF page for the vision call (independent of on-screen size). */
async function pageImage(page: PDFPageProxy): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  const scale = 1568 / Math.max(base.width, base.height);
  const vp = page.getViewport({ scale });
  const c = document.createElement("canvas");
  c.width = Math.floor(vp.width);
  c.height = Math.floor(vp.height);
  await page.render({ canvas: c, viewport: vp }).promise;
  return c;
}

/**
 * Locate a value in a PDF. Tries the given page's text, then other pages'
 * text, then (for pages without usable text) Claude vision on the given page.
 */
export async function locateInPdf(fileId: string, pageHint: number | null, t: Target, docPages: number[]): Promise<LocateResult> {
  const pdf = await loadPdf(fileId);
  const first = pageHint && pageHint <= pdf.numPages ? pageHint : (docPages[0] ?? 1);
  const page = await pdf.getPage(first);
  const ix = await textIndex(fileId, page);

  if (ix.chars > 40) {
    const boxes = searchText(ix, t);
    if (boxes.length) return { page: first, boxes, method: "text" };
    // Value may sit on a neighbouring page of the same document.
    const others = (docPages.length ? docPages : Array.from({ length: pdf.numPages }, (_, i) => i + 1)).filter((n) => n !== first && n <= pdf.numPages);
    for (const n of others) {
      const ixn = await textIndex(fileId, await pdf.getPage(n));
      const b = ixn.chars > 40 ? searchText(ixn, t) : [];
      if (b.length) return { page: n, boxes: b, method: "text" };
    }
  }

  try {
    const boxes = await locateByVision(fileId, first, await pageImage(page), t);
    return { page: first, boxes, method: boxes.length ? "vision" : "none" };
  } catch (e) {
    return { page: first, boxes: [], method: "none", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function locateInImage(fileId: string, t: Target): Promise<LocateResult> {
  const img = await loadImage(fileId);
  try {
    const boxes = await locateByVision(fileId, 1, img, t);
    return { page: 1, boxes, method: boxes.length ? "vision" : "none" };
  } catch (e) {
    return { page: 1, boxes: [], method: "none", error: e instanceof Error ? e.message : String(e) };
  }
}
