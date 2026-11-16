import { runAgentTurn, type AgentEvent } from "@/lib/agent";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = store.sessions.get(id);
  if (!session) return Response.json({ error: "Session not found — please start a new chat." }, { status: 404 });
  if (session.busy) return Response.json({ error: "The assistant is still working on your previous message." }, { status: 409 });

  const body = (await req.json()) as { text?: string; fileIds?: string[] };
  const fileIds = (body.fileIds ?? []).filter((f) => store.files.get(f)?.sessionId === id);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          /* client went away; keep working so the report still completes */
        }
      };
      // Hosting proxies close connections that go quiet; the comparison step can
      // run for minutes without events, so send an SSE comment every 15 s.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {}
      }, 15000);
      session.busy = true;
      try {
        await runAgentTurn(session, body.text ?? "", fileIds, emit);
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        clearInterval(heartbeat);
        session.busy = false;
        emit({ type: "done" });
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
