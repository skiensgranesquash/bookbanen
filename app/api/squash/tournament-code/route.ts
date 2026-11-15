import { NextRequest, NextResponse } from "next/server";
import { isTournamentCodeValid } from "@/lib/settings/tournament";

export const dynamic = "force-dynamic";

/**
 * GET /api/squash/tournament-code?code=...
 *
 * Offentlig (ingen innlogging kreves) – lar bookingsiden sjekke om en
 * turneringskode kunden skriver inn er gyldig AKKURAT NÅ, mens de fortsatt
 * fyller ut skjemaet (se app/BookingCalendar.tsx). Svarer KUN med
 * true/false – aldri noe om selve koden, om turneringen er av/på, eller
 * utløpsdatoen, slik at noen som prøver seg frem ikke lærer noe nyttig av
 * svaret. Selve bookingen (se app/api/squash/bookings/route.ts) validerer
 * uansett koden PÅ NYTT server-side – denne ruten er bare for å gi kunden
 * rask tilbakemelding mens de skriver.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") ?? "";
  if (!code.trim()) return NextResponse.json({ valid: false });

  try {
    const valid = await isTournamentCodeValid(code);
    return NextResponse.json({ valid });
  } catch (err) {
    console.error("[tournament-code] feil ved sjekk av kode:", err);
    return NextResponse.json({ valid: false });
  }
}
