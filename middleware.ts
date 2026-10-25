import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionCookieValue } from "@/lib/auth/session";

/**
 * Beskytter /admin/** (siden) og /api/admin/** (API-et) – begge deler krever
 * en gyldig, signert sesjonscookie. /admin/login og /api/admin/login er
 * unntatt (det er jo der man logger inn).
 *
 * I tillegg: en "bookings_only"-administrator (begrenset admin, se AdminRole
 * i lib/db/types.ts) får kun tilgang til Bookinger-fanen (siden "/admin" –
 * selve Oversikt-siden med kalender/avtaler/blokkering) og "/admin/account"
 * (for å kunne bytte sitt eget passord) – se listene lenger ned. ALT annet
 * (Åpningstider, Utseende, Innstillinger/Vipps, OG "/api/admin/account/users"
 * som oppretter/lister admin-brukere) er stengt for denne rollen, slik at en
 * begrenset administrator aldri kan gi seg selv – eller noen andre – flere
 * rettigheter enn det en full administrator opprinnelig satte dem opp med.
 * Dette håndheves her, ETT sted, i stedet for i hver enkelt rute, akkurat som
 * selve innloggingssjekken allerede gjør – og siden rollen ligger signert i
 * selve sesjonscookien (se session.ts), trengs ingen ekstra databaseoppslag
 * per forespørsel for å håndheve det.
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

/** Sider en "bookings_only"-administrator får åpne (nøyaktig disse – ikke prefiks, siden f.eks. "/admin/opening-hours" ellers ville matchet "/admin"). */
const BOOKINGS_ONLY_ALLOWED_PAGES = new Set(["/admin", "/admin/account"]);

/** API-endepunkt en "bookings_only"-administrator får kalle – nøyaktige stier, eller prefikser der ruten har undersider ([id], manual, osv.). */
const BOOKINGS_ONLY_ALLOWED_API_EXACT = new Set([
  "/api/admin/me",
  "/api/admin/logout",
  "/api/admin/block",
  "/api/admin/account/password",
]);
const BOOKINGS_ONLY_ALLOWED_API_PREFIXES = ["/api/admin/bookings"];

function isAllowedForBookingsOnly(pathname: string, isPage: boolean): boolean {
  if (isPage) return BOOKINGS_ONLY_ALLOWED_PAGES.has(pathname);
  return (
    BOOKINGS_ONLY_ALLOWED_API_EXACT.has(pathname) ||
    BOOKINGS_ONLY_ALLOWED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isAdminApi = pathname.startsWith("/api/admin") && pathname !== "/api/admin/login";
  const isAdminPage = pathname.startsWith("/admin") && pathname !== "/admin/login";

  if (!isAdminApi && !isAdminPage) return NextResponse.next();

  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionCookieValue(cookieValue);

  if (session) {
    if (session.role === "bookings_only" && !isAllowedForBookingsOnly(pathname, isAdminPage)) {
      if (isAdminApi) {
        return NextResponse.json({ error: "Du har ikke tilgang til dette som begrenset administrator." }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return NextResponse.next();
  }

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
