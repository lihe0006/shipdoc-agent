import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authEnabled, authToken, safeEqual } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  if (!authEnabled()) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();

  const cookie = req.cookies.get(AUTH_COOKIE)?.value ?? "";
  if (cookie && safeEqual(cookie, await authToken())) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  runtime: "nodejs",
  // The upload and locate routes are excluded: running middleware on large multipart bodies
  // breaks req.formData() ("body object should not be disturbed or locked").
  // Those routes check the sign-in cookie themselves.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/sessions/[^/]+/files|api/locate).*)"],
};
