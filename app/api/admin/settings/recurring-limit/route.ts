import { NextRequest, NextResponse } from "next/server";
import { getRecurringCutoffDate, saveRecurringCutoffDate } from "@/lib/settings/recurringLimit";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/settings/recurring-limit – hent siste dato for gjentakende
 *      bookinger (`cutoffDate: null` betyr at ingen egen dato er satt).
 * POST /api/admin/settings/recurring-limit – sett (eller fjern, med
 *      `cutoffDate: null`) denne datoen.
 *
 * Beskyttet av middleware.ts som resten av /api/admin/** – krever gyldig
 * admin-sesjon.
 */
export async function GET() {
  try {
    const cutoffDate = await getRecurringCutoffDate();
    return NextResponse.json({ cutoffDate });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Kunne ikke hente grensen." },
      { status: 500 }
    );
  }
}

interface SaveBody {
  cutoffDate?: string | null;
}

export async function POST(request: NextRequest) {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  try {
    const cutoffDate = await saveRecurringCutoffDate(body.cutoffDate ?? null);
    return NextResponse.json({ ok: true, cutoffDate });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Kunne ikke lagre." }, { status: 400 });
  }
}
