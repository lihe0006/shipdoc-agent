"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Check, FileSearch, FileText, MessageSquarePlus, Paperclip, ShieldCheck, Upload, X, AlertCircle, ExternalLink } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import type { Status } from "@/lib/schemas";
import { STATUS_LABEL, formatBytes } from "@/lib/ui";
import s from "./chat.module.css";

type ToolPart = { kind: "tool"; id: string; label: string; progress: string[]; state: "running" | "ok" | "error"; summary?: string };
type ReportPart = { kind: "report"; reportId: string; shipmentRef: string; overall: string; counts: Record<Status, number> };
type Part = { kind: "text"; text: string } | ToolPart | ReportPart | { kind: "error"; message: string };
type UIMessage =
  | { id: string; role: "user"; text: string; files: { name: string; size: number }[] }
  | { id: string; role: "assistant"; parts: Part[]; done: boolean };

const SHORTCUTS = [
  { icon: Upload, title: "Check a shipment", sub: "Upload the CIPL, BL and Form E — I'll compare every field", action: "upload" as const },
  { icon: FileSearch, title: "What do you compare?", sub: "See the data fields and rules I check across documents", action: "What data fields do you compare across the CIPL, BL and Form E, and how do you decide what is a mismatch?" },
  { icon: ShieldCheck, title: "Form E preference risks", sub: "What typically voids a Form E preferential duty claim", action: "Which differences between the Form E and the other documents typically put the preferential duty claim at risk?" },
];

/** Sends the user to the password screen when their sign-in has expired. */
function checkAuth(res: Response) {
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Please sign in again.");
  }
}

let uid = 0;
const nextId = () => `m${++uid}`;

export default function ChatPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const newSession = useCallback(async () => {
    const r = await fetch("/api/sessions", { method: "POST" });
    checkAuth(r);
    const j = await r.json();
    setSessionId(j.sessionId);
    setMessages([]);
    setPending([]);
    setInput("");
    setNotice(null);
  }, []);

  useEffect(() => {
    void newSession();
  }, [newSession]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const addFiles = (list: FileList | File[]) => {
    const ok: File[] = [];
    const bad: string[] = [];
    for (const f of Array.from(list)) {
      if (/\.(pdf|png|jpe?g|webp)$/i.test(f.name)) ok.push(f);
      else bad.push(f.name);
    }
    if (bad.length) setNotice(`Only PDF and image files are supported. Skipped: ${bad.join(", ")}`);
    setPending((p) => [...p, ...ok.filter((f) => !p.some((x) => x.name === f.name && x.size === f.size))]);
    taRef.current?.focus();
  };

  const updateAssistant = (id: string, fn: (parts: Part[]) => Part[], done?: boolean) =>
    setMessages((ms) => ms.map((m) => (m.id === id && m.role === "assistant" ? { ...m, parts: fn(m.parts), done: done ?? m.done } : m)));

  const send = async (textArg?: string) => {
    const text = (textArg ?? input).trim();
    if (!sessionId || busy || (!text && pending.length === 0)) return;
    const files = pending;
    setInput("");
    setPending([]);
    setNotice(null);
    setBusy(true);

    const userMsg: UIMessage = { id: nextId(), role: "user", text, files: files.map((f) => ({ name: f.name, size: f.size })) };
    const aId = nextId();
    setMessages((ms) => [...ms, userMsg, { id: aId, role: "assistant", parts: [], done: false }]);

    try {
      const fileIds: string[] = [];
      if (files.length) {
        // One file per request keeps each request small for hosting proxies.
        const rejected: string[] = [];
        for (const f of files) {
          const fd = new FormData();
          fd.append("files", f);
          const up = await fetch(`/api/sessions/${sessionId}/files`, { method: "POST", body: fd });
          checkAuth(up);
          const uj = await up.json().catch(() => ({ error: `Upload of ${f.name} failed (HTTP ${up.status}).` }));
          if (!up.ok) throw new Error(uj.error ?? `Upload of ${f.name} failed.`);
          fileIds.push(...uj.files.map((x: { id: string }) => x.id));
          rejected.push(...(uj.rejected ?? []));
        }
        if (rejected.length) setNotice(`Not uploaded (unsupported or over 25 MB): ${rejected.join(", ")}`);
      }

      const res = await fetch(`/api/sessions/${sessionId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, fileIds }),
      });
      checkAuth(res);
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (!chunk.startsWith("data: ")) continue;
          const e = JSON.parse(chunk.slice(6));
          handleEvent(aId, e);
        }
      }
    } catch (err) {
      updateAssistant(aId, (p) => [...p, { kind: "error", message: err instanceof Error ? err.message : String(err) }]);
    } finally {
      updateAssistant(aId, (p) => p, true);
      setBusy(false);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleEvent = (aId: string, e: any) => {
    switch (e.type) {
      case "text":
        updateAssistant(aId, (parts) => {
          const last = parts[parts.length - 1];
          if (last?.kind === "text") return [...parts.slice(0, -1), { kind: "text", text: last.text + e.delta }];
          return [...parts, { kind: "text", text: e.delta }];
        });
        break;
      case "tool_start":
        updateAssistant(aId, (parts) => [...parts, { kind: "tool", id: e.id, label: e.label, progress: [], state: "running" }]);
        break;
      case "tool_progress":
        updateAssistant(aId, (parts) => parts.map((p) => (p.kind === "tool" && p.id === e.id ? { ...p, progress: [...p.progress, e.message] } : p)));
        break;
      case "tool_end":
        updateAssistant(aId, (parts) =>
          parts.map((p) => (p.kind === "tool" && p.id === e.id ? { ...p, state: e.ok ? "ok" : "error", summary: e.summary } : p)),
        );
        break;
      case "report":
        updateAssistant(aId, (parts) => [
          ...parts.filter((p) => !(p.kind === "report" && p.reportId === e.reportId)),
          { kind: "report", reportId: e.reportId, shipmentRef: e.shipmentRef, overall: e.overall, counts: e.counts },
        ]);
        break;
      case "error":
        updateAssistant(aId, (parts) => [...parts, { kind: "error", message: e.message }]);
        break;
    }
  };

  const onShortcut = (action: string) => {
    if (action === "upload") fileInput.current?.click();
    else void send(action);
  };

  return (
    <div
      className={s.app}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      <header className={s.top}>
        <div className={s.brand}>
          <span className={s.brandMark}>
            <FileText size={16} strokeWidth={2} />
          </span>
          Shipment document check
        </div>
        <button className="btn" onClick={() => void newSession()} disabled={busy}>
          <MessageSquarePlus size={16} strokeWidth={1.7} /> New chat
        </button>
      </header>

      <div className={s.body} ref={bodyRef}>
        <div className={s.col}>
          {messages.length === 0 ? (
            <div className={s.welcome}>
              <div className={s.mark}>
                <FileSearch size={34} color="#fff" strokeWidth={1.7} />
              </div>
              <h1 className={s.greet}>Hello 👋</h1>
              <p className={s.sub}>
                I am your shipping document checking assistant. Upload one shipment&apos;s CIPL, bill of lading and Form E — I&apos;ll read every
                page, line up the common data fields and line items, and give you a results page with every mismatch and where it came from.
              </p>
              <div className={s.shortcuts}>
                {SHORTCUTS.map((sc) => (
                  <button key={sc.title} className={s.shortcut} onClick={() => onShortcut(sc.action)} disabled={!sessionId}>
                    <span className={s.shortcutIcon}>
                      <sc.icon size={18} strokeWidth={1.7} />
                    </span>
                    <span>
                      <span className={s.shortcutTitle}>{sc.title}</span>
                      <span className={s.shortcutSub}>{sc.sub}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className={s.userRow}>
                  <div className={s.userBubble}>
                    {m.files.length > 0 && (
                      <div className={s.msgFiles}>
                        {m.files.map((f) => (
                          <span key={f.name} className={s.fileChip}>
                            <FileText size={14} strokeWidth={1.7} /> {f.name} <span className="muted">{formatBytes(f.size)}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {m.text && <div>{m.text}</div>}
                  </div>
                </div>
              ) : (
                <div key={m.id} className={s.assistant}>
                  {m.parts.length === 0 && !m.done && (
                    <div className={s.thinking}>
                      <span className="spinner" /> Working on it…
                    </div>
                  )}
                  {m.parts.map((p, i) => {
                    if (p.kind === "text") return <div key={i} className={s.md}><Markdown text={p.text} /></div>;
                    if (p.kind === "error")
                      return (
                        <div key={i} className={s.error}>
                          <AlertCircle size={16} /> {p.message}
                        </div>
                      );
                    if (p.kind === "tool") return <ToolRow key={i} part={p} />;
                    return <ReportCard key={i} part={p} />;
                  })}
                </div>
              ),
            )
          )}
        </div>
      </div>

      <div className={s.composerZone}>
        {notice && <div className={s.notice}>{notice}</div>}
        <div className={s.composer}>
          {pending.length > 0 && (
            <div className={s.pending}>
              {pending.map((f, i) => (
                <span key={`${f.name}-${i}`} className={s.fileChip}>
                  <FileText size={14} strokeWidth={1.7} /> {f.name} <span className="muted">{formatBytes(f.size)}</span>
                  <button aria-label={`Remove ${f.name}`} className={s.chipX} onClick={() => setPending((p) => p.filter((_, j) => j !== i))}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            className={s.ta}
            rows={2}
            value={input}
            placeholder={pending.length ? "Add a note, or just press Enter to start the check" : "Upload shipment documents or ask a question…"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className={s.bar}>
            <button className={s.attach} aria-label="Attach documents" onClick={() => fileInput.current?.click()}>
              <Paperclip size={16} strokeWidth={1.7} />
            </button>
            <button className={s.send} aria-label="Send" disabled={busy || !sessionId || (!input.trim() && pending.length === 0)} onClick={() => void send()}>
              {busy ? <span className="spinner" /> : <ArrowUp size={16} strokeWidth={2} />}
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        <div className={s.disclaimer}>AI-generated findings — confirm against the original documents before acting on them.</div>
      </div>

      {dragging && (
        <div className={s.drop}>
          <Upload size={28} />
          Drop shipment documents to attach
        </div>
      )}
    </div>
  );
}

function ToolRow({ part }: { part: ToolPart }) {
  return (
    <div className={s.tool}>
      <div className={s.toolHead}>
        {part.state === "running" ? (
          <span className="spinner" />
        ) : part.state === "ok" ? (
          <span className={s.toolOk}>
            <Check size={11} strokeWidth={3} />
          </span>
        ) : (
          <AlertCircle size={16} color="var(--danger)" />
        )}
        <span className={s.toolLabel}>{part.label}</span>
        {part.summary && <span className="muted">· {part.summary}</span>}
      </div>
      {part.progress.length > 0 && (
        <ul className={s.toolProgress}>
          {part.progress.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportCard({ part }: { part: ReportPart }) {
  const order: Status[] = ["mismatch", "minor", "missing", "match"];
  const verdict = part.overall === "mismatch" ? "Mismatches found" : part.overall === "review" ? "Needs review" : "All clear";
  return (
    <div className={s.report}>
      <div className={s.reportHead}>
        <div>
          <div className={s.reportTitle}>Results page ready</div>
          <div className="muted" style={{ fontSize: "var(--text-xs)" }}>
            Shipment {part.shipmentRef} · {verdict}
          </div>
        </div>
        <a className="btn btn--primary" href={`/reports/${part.reportId}`} target="_blank" rel="noreferrer">
          Open results <ExternalLink size={14} />
        </a>
      </div>
      <div className={s.reportCounts}>
        {order.map((k) => (
          <span key={k} className={`pill pill--${k}`}>
            {part.counts[k]} {STATUS_LABEL[k].toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  );
}
