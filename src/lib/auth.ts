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

/** True when the request carries a valid sign-in cookie (or the gate is off). */
export async function isAuthed(req: Request): Promise<boolean> {
  if (!authEnabled()) return true;
  const cookie = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${AUTH_COOKIE}=`))
    ?.slice(AUTH_COOKIE.length + 1);
  return !!cookie && safeEqual(decodeURIComponent(cookie), await authToken());
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
