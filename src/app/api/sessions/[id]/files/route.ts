import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { saveUpload, store } from "@/lib/store";

const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthed(req))) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { id } = await params;
  if (!store.sessions.has(id)) return NextResponse.json({ error: "Session not found — please start a new chat." }, { status: 404 });

  const form = await req.formData();
  const out: { id: string; name: string; size: number; mediaType: string }[] = [];
  const rejected: string[] = [];

  for (const entry of form.getAll("files")) {
    if (!(entry instanceof File)) continue;
    const type = entry.type || (entry.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
    if (!ALLOWED.has(type) || entry.size > MAX_BYTES) {
      rejected.push(entry.name);
      continue;
    }
    const f = await saveUpload(id, entry.name, type, Buffer.from(await entry.arrayBuffer()));
    out.push({ id: f.id, name: f.name, size: f.size, mediaType: f.mediaType });
  }
  return NextResponse.json({ files: out, rejected });
}
