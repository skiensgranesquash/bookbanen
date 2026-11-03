import { NextResponse } from "next/server";
import { getHoursContext } from "@/lib/settings/openingHours";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/bookings/hours
 *
 * Returnerer hele åpningstids-konteksten (ukentlig standard + alle
 * ferie/annerledesdag-unntak) – samme form som /api/admin/settings/hours
 * sitt GET-svar – slik at ADMIN-KALENDEREN
 * (app/admin/BookingsInsights.tsx) kan markere stengte dager med rødt, og
 * forhåndsvise en gjentakende rekkes datoer, uten ett nettverkskall per
 * dato.
 *
 * Ligger under /api/admin/bookings/** (IKKE /api/admin/settings/**) med
 * VILJE: en "bookings_only"-administrator får ikke åpne
 * "/admin/opening-hours" eller resten av /api/admin/settings/** (se
 * middleware.ts), men skal likevel se de samme stengte dagene i
 * Bookinger-fanen sin egen kalender. Dette er bare en LESE-rute (ingen
 * lagring), så det utvider ikke hva en begrenset administrator kan ENDRE –
 * kun hva de kan SE, akkurat som resten av /api/admin/bookings/** allerede
 * lar dem gjøre.
 */
export async function GET() {
  try {
    const context = await getHoursContext();
    return NextResponse.json(context);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Kunne ikke hente åpningstider." },
      { status: 500 }
    );
  }
}
