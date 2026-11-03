import { NextRequest, NextResponse } from "next/server";
import { getSingleBookingMaxDaysAhead, saveSingleBookingMaxDaysAhead } from "@/lib/settings/singleBookingLimit";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/settings/single-booking-limit - hent hvor mange dager
 *      frem i tid en enkelttime har lov til å bookes (kundens egen,
 *      selvbetjente booking på bookingsiden - se
 *      lib/settings/singleBookingLimit.ts).
 * POST /api/admin/settings/single-booking-limit - sett (eller fjern, med
 *      `null`, som gir tilbake standardverdien MAX_DAYS_AHEAD) grensen.
 *
 * Beskyttet av middleware.ts som resten av /api/admin/** - krever gyldig
 * admin-sesjon.
 */
export async function GET() {
  try {
    const maxDaysAhead = await getSingleBookingMaxDaysAhead();
    return NextResponse.json({ maxDaysAhead });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Kunne ikke hente grensen." },
      { status: 500 }
    );
  }
}

interface SaveBody {
  maxDaysAhead?: number | null;
}

export async function POST(request: NextRequest) {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  try {
    const maxDaysAhead = await saveSingleBookingMaxDaysAhead(body.maxDaysAhead ?? null);
    return NextResponse.json({ ok: true, maxDaysAhead });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Kunne ikke lagre." }, { status: 400 });
  }
}
