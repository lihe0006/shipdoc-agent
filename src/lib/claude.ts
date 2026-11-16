import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

/**
 * Server-side refusal fallback: if the model declines for policy reasons, the
 * API re-runs the request on its default fallback model within the same call.
 */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01" as const;

const g = globalThis as unknown as { __anthropic?: Anthropic };
export function client(): Anthropic {
  // Reads ANTHROPIC_API_KEY from .env.local.
  return (g.__anthropic ??= new Anthropic({ maxRetries: 3 }));
}

export function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export function describeApiError(err: unknown): string {
  if (!process.env.ANTHROPIC_API_KEY) return "No Anthropic API key is configured. Add ANTHROPIC_API_KEY to .env.local and restart the dev server.";
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key is missing or invalid. Set ANTHROPIC_API_KEY in .env.local and restart.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API — please retry in a minute.";
  if (err instanceof Anthropic.BadRequestError) return `Request rejected by the API: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ""}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
