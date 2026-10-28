import { NextRequest, NextResponse } from "next/server";
import {
  getRecurringCutoffDate,
  getRecurringMaxWeeks,
  saveRecurringCutoffDate,
  saveRecurringMaxWeeks,
} from "@/lib/settings/recurringLimit";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/settings/recurring-limit - hent både siste dato for
 *      gjentakende bookinger OG maks antall uker i en serie (`null` betyr at
 *      den aktuelle grensen ikke er satt).
 * POST /api/admin/settings/recurring-limit - sett (eller fjern, med `null`)
 *      ÉN av de to - body sender bare det feltet som faktisk endres (det
 *      andre feltet røres ikke, og trenger ikke være med i det hele tatt).
 *
 * Beskyttet av middleware.ts som resten av /api/admin/** - krever gyldig
 * admin-sesjon.
 */
export async function GET() {
  try {
    const [cutoffDate, maxWeeks] = await Promise.all([getRecurringCutoffDate(), getRecurringMaxWeeks()]);
    return NextResponse.json({ cutoffDate, maxWeeks });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Kunne ikke hente grensen." },
      { status: 500 }
    );
  }
}

interface SaveBody {
  cutoffDate?: string | null;
  maxWeeks?: number | null;
}

export async function POST(request: NextRequest) {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  try {
    const touchesCutoff = Object.prototype.hasOwnProperty.call(body, "cutoffDate");
    const touchesMaxWeeks = Object.prototype.hasOwnProperty.call(body, "maxWeeks");

    if (touchesCutoff) await saveRecurringCutoffDate(body.cutoffDate ?? null);
    if (touchesMaxWeeks) await saveRecurringMaxWeeks(body.maxWeeks ?? null);

    const [cutoffDate, maxWeeks] = await Promise.all([getRecurringCutoffDate(), getRecurringMaxWeeks()]);
    return NextResponse.json({ ok: true, cutoffDate, maxWeeks });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Kunne ikke lagre." }, { status: 400 });
  }
}
