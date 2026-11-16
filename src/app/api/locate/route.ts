import { NextResponse } from "next/server";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { isAuthed } from "@/lib/auth";
import { client, describeApiError, FALLBACK_BETA, MODEL } from "@/lib/claude";
import { store } from "@/lib/store";

/**
 * Finds where a value sits on a page image (used for scanned pages, which have
 * no text layer to search). The browser renders the page and sends the image;
 * Claude returns pixel boxes, which we normalise to 0–1 of the image size.
 */

export const maxDuration = 120;

const Body = z.object({
  fileId: z.string().min(1),
  page: z.number().int().min(1),
  image: z.string().startsWith("data:image/"),
  width: z.number().positive(),
  height: z.number().positive(),
  label: z.string().max(200),
  value: z.string().max(2000),
  context: z.string().max(4000).nullable(),
});

const Located = z.object({
  found: z.boolean(),
  boxes: z.array(z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() })),
});

type Box = { x0: number; y0: number; x1: number; y1: number };
const g = globalThis as unknown as { __locateCache?: Map<string, Box[]> };
const cache = (g.__locateCache ??= new Map());

const SYSTEM = `You locate text on images of shipping-document pages (invoices, packing lists, bills of lading, Malaysian K1 customs declarations, Form E certificates). Pages may be scanned, skewed or handwritten.

You are given one page image, its exact pixel size, and a value that was transcribed from this page. Return tight bounding boxes, in pixel coordinates of this image (origin top-left, x to the right, y down), around where that value is written.
- If the value spans several lines (an address, a description), return one box per line.
- Box the value itself, not its printed label, unless the value is only identifiable together with the label.
- For a table row (line item), box the row's description and quantity cells.
- If the value is not on this page, set found to false and return no boxes. Never guess a location.`;

export async function POST(req: Request) {
  if (!(await isAuthed(req))) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const b = parsed.data;
  if (!store.files.has(b.fileId)) return NextResponse.json({ error: "File not found" }, { status: 404 });

  const key = JSON.stringify([b.fileId, b.page, b.label, b.value, b.context]);
  const hit = cache.get(key);
  if (hit) return NextResponse.json({ boxes: hit });

  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(b.image);
  if (!m) return NextResponse.json({ error: "Bad image" }, { status: 400 });

  try {
    const msg = await client()
      .beta.messages.stream({
        model: MODEL,
        max_tokens: 4000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "low", format: betaZodOutputFormat(Located) },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: m[1] as "image/png" | "image/jpeg" | "image/webp", data: m[2] } },
              {
                type: "text",
                text: [
                  `Image size: ${Math.round(b.width)} × ${Math.round(b.height)} pixels.`,
                  `Field: ${b.label}`,
                  `Value to locate: ${b.value}`,
                  b.context ? `Text transcribed around it: ${b.context}` : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
              },
            ],
          },
        ],
      })
      .finalMessage();

    const out = msg.parsed_output;
    const boxes: Box[] = out?.found
      ? out.boxes
          .map((x) => ({
            x0: clamp(Math.min(x.x0, x.x1) / b.width),
            y0: clamp(Math.min(x.y0, x.y1) / b.height),
            x1: clamp(Math.max(x.x0, x.x1) / b.width),
            y1: clamp(Math.max(x.y0, x.y1) / b.height),
          }))
          .filter((x) => x.x1 - x.x0 > 0.002 && x.y1 - x.y0 > 0.002)
      : [];
    cache.set(key, boxes);
    return NextResponse.json({ boxes });
  } catch (err) {
    return NextResponse.json({ error: describeApiError(err) }, { status: 502 });
  }
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
