# Shipment document check (POC)

An agent-first web app: the user chats with an assistant, uploads one shipment's
**CIPL, bill(s) of lading and Form E**, and the agent reads every page,
lines up the common data fields and line items, judges each difference and
publishes a **results page** with every mismatch linked back to its source page.

## Run

```bash
npm install
# put your key in .env.local → ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

Open http://localhost:3000, drop the PDFs into the chat and press Enter.

To host it for other people with a shared password, see [DEPLOY.md](DEPLOY.md).
Settings are listed in [.env.example](.env.example); leaving `APP_PASSWORD`
empty turns the login screen off.

## How it works

| Piece | File |
|---|---|
| Agent loop (Claude Opus 5.5, tools, SSE streaming) | `src/lib/agent.ts` |
| Tool: `extract_documents` — vision extraction per file, structured output | `src/lib/extract.ts` |
| Tool: `compare_documents` — cross-document judgement, builds the report | `src/lib/compare.ts` |
| Tools: `get_report`, `update_finding` — follow-up Q&A and overrides | `src/lib/agent.ts` |
| Field catalog (what is compared, where it sits on each form, mismatch rules) | `src/lib/fields.ts` |
| Chat UI | `src/app/page.tsx` |
| Results page (fields / line items / checks, source viewer, overrides) | `src/app/reports/[id]/page.tsx` |
| Excel export | `src/app/api/reports/[id]/xlsx/route.ts` |

- Each uploaded file can hold several documents (a CIPL holds invoices and packing
  lists; House and Master BLs are kept separate). Invoices in one file are grouped.
- Statuses: **match**, **minor difference**, **mismatch**, **missing**, **single source**.
  The agent decides the source of truth per field and explains each verdict.
- Every value carries a page number and verbatim snippet; clicking `p.N` opens the
  original PDF at that page beside the table.
- Reviewers can override a verdict on the page; the agent is told on its next turn.
  Asking the agent ("accept the weight difference") does the same from chat.
- Refusal fallback (`server-side-fallback-2026-07-01`, `fallbacks: "default"`) is on
  for every model call.

## POC limits

- No database: sessions and reports live in server memory and vanish on restart;
  uploads are written to `.data/uploads/`.
- Source links jump to the page and show the snippet; they don't draw a box on the PDF.
- Access control is one shared password (`APP_PASSWORD`), not per-user accounts.
- `POST /api/dev/fixture` (dev only) loads the sample PDFs with a small hand-written
  report to preview the results page without calling the API.
