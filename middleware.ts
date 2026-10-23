import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionCookieValue } from "@/lib/auth/session";

/**
 * Beskytter /admin/** (siden) og /api/admin/** (API-et) – begge deler krever
 * en gyldig, signert sesjonscookie. /admin/login og /api/admin/login er
 * unntatt (det er jo der man logger inn).
 *
 * Kjører i Next.js sin Edge-runtime som standard, derfor bruker
 * lib/auth/session.ts kun Web Crypto (ikke node:crypto).
 *
 * NB (Next.js 16): filnavnet "middleware.ts" er merket "deprecated" til
 * fordel for "proxy.ts", men fungerer fortsatt fullt ut og er den eneste
 * varianten som støtter Edge-runtime (proxy.ts kjører alltid i Node.js).
 * Siden koden vår allerede er Edge-kompatibel (Web Crypto), er det ingen
 * hast med å bytte – det kan gjøres senere ved bare å endre filnavn og
 * eksportnavn (`middleware` -> `proxy`) hvis/når Node.js-runtime uansett
 * er greit, se Next sin oppgraderingsguide for v16.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isAdminApi = pathname.startsWith("/api/admin") && pathname !== "/api/admin/login";
  const isAdminPage = pathname.startsWith("/admin") && pathname !== "/admin/login";

  if (!isAdminApi && !isAdminPage) return NextResponse.next();

  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionCookieValue(cookieValue);

  if (session) return NextResponse.next();

  if (isAdminApi) {
    return NextResponse.json({ error: "Ikke innlogget." }, { status: 401 });
  }

  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
