import { promises as fs } from "fs";
import { store } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = store.files.get(id);
  if (!f) return new Response("Not found", { status: 404 });
  const bytes = await fs.readFile(f.path);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": f.mediaType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(f.name)}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
