import type Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "fs";
import path from "path";
import { nanoid } from "nanoid";
import type { ComparisonResult, ExtractionResult, Status } from "./schemas";

/**
 * In-memory store for the POC (no database). Uploaded files are written to
 * .data/uploads so the PDF viewer can serve them; everything else lives in
 * process memory and is lost on restart.
 */

export interface StoredFile {
  id: string;
  sessionId: string;
  name: string;
  mediaType: string;
  size: number;
  path: string;
  uploadedAt: number;
  extraction?: ExtractionResult;
  extractionError?: string;
}

export interface Override {
  status: Status;
  note: string;
  by: "agent" | "user";
  at: number;
  previousStatus: Status;
}

export interface DocRef {
  ref: string; // e.g. "D1"
  fileId: string;
  docIndex: number;
  fileName: string;
  docType: string;
  subtype: string | null;
  title: string;
  docNumber: string | null;
  pages: number[];
}

export interface Report {
  id: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  docs: DocRef[];
  result: ComparisonResult;
  /** Finding id (h1, l3, c2…) → override. */
  overrides: Record<string, Override>;
}

export interface Session {
  id: string;
  createdAt: number;
  messages: Anthropic.Beta.BetaMessageParam[];
  fileIds: string[];
  reportId?: string;
  busy: boolean;
  /** Reviewer actions taken on the results page, passed to the agent on its next turn. */
  pendingNotes: string[];
}

interface Store {
  sessions: Map<string, Session>;
  files: Map<string, StoredFile>;
  reports: Map<string, Report>;
}

const g = globalThis as unknown as { __shipdocStore?: Store };
export const store: Store =
  g.__shipdocStore ?? (g.__shipdocStore = { sessions: new Map(), files: new Map(), reports: new Map() });

export const UPLOAD_DIR = path.join(process.cwd(), ".data", "uploads");

export function createSession(): Session {
  const s: Session = { id: nanoid(10), createdAt: Date.now(), messages: [], fileIds: [], busy: false, pendingNotes: [] };
  store.sessions.set(s.id, s);
  return s;
}

export async function saveUpload(sessionId: string, name: string, mediaType: string, bytes: Buffer) {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const id = nanoid(10);
  const ext = path.extname(name) || (mediaType === "application/pdf" ? ".pdf" : "");
  const filePath = path.join(UPLOAD_DIR, `${id}${ext}`);
  await fs.writeFile(filePath, bytes);
  const f: StoredFile = { id, sessionId, name, mediaType, size: bytes.length, path: filePath, uploadedAt: Date.now() };
  store.files.set(id, f);
  store.sessions.get(sessionId)?.fileIds.push(id);
  return f;
}

/** Stable finding ids: h = header field, l = line item, c = consistency check. */
export function findingId(kind: "h" | "l" | "c", index: number) {
  return `${kind}${index + 1}`;
}

export function effectiveStatus(report: Report, id: string, original: Status): Status {
  return report.overrides[id]?.status ?? original;
}

export function reportCounts(report: Report) {
  const counts: Record<Status, number> = { match: 0, minor: 0, mismatch: 0, missing: 0, single_source: 0 };
  const add = (id: string, s: Status) => (counts[effectiveStatus(report, id, s)] += 1);
  report.result.header_fields.forEach((f, i) => add(findingId("h", i), f.status));
  report.result.line_items.forEach((f, i) => add(findingId("l", i), f.status));
  report.result.checks.forEach((f, i) => add(findingId("c", i), f.status));
  return counts;
}
