/**
 * Shared-password gate for hosted demos. When APP_PASSWORD is unset (local
 * development) the gate is off.
 */
export const AUTH_COOKIE = "shipdoc_auth";

export function authEnabled() {
  return !!process.env.APP_PASSWORD;
}

/** Cookie value = SHA-256 of the password plus a server-side salt. */
export async function authToken(): Promise<string> {
  const salt = process.env.AUTH_SECRET || "shipdoc-poc";
  const data = new TextEncoder().encode(`${salt}:${process.env.APP_PASSWORD ?? ""}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
