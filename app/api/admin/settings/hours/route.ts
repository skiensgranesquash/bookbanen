import { NextRequest, NextResponse } from "next/server";
import { getExceptions, getWeeklyHours, saveWeeklyHours, type TimeInterval, type WeekdayKey } from "@/lib/settings/openingHours";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/settings/hours  – ukentlige standard-åpningstider OG alle
 *      "ferie/annerledesdag"-unntak, i ett kall (siden adminsiden alltid
 *      viser begge delene sammen).
 * POST /api/admin/settings/hours  – lagre ukentlige standard-åpningstider.
 *
 * Unntakene (ferier/annerledesdager) håndteres av den separate
 * .../hours/exceptions-ruten, siden de er masse-redigerbare per dato i
 * stedet for ett samlet skjema.
 *
 * Beskyttet av middleware.ts som resten av /api/admin/** – krever gyldig
 * admin-sesjon.
 */
export async function GET() {
  try {
    const [weekly, exceptions] = await Promise.all([getWeeklyHours(), getExceptions()]);
    return NextResponse.json({ weekly, exceptions });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Kunne ikke hente åpningstider." },
      { status: 500 }
    );
  }
}

interface SaveWeeklyBody {
  weekly?: Partial<Record<WeekdayKey, { closed?: boolean; intervals?: Partial<TimeInterval>[] }>>;
}

export async function POST(request: NextRequest) {
  let body: SaveWeeklyBody;
  try {
    body = (await request.json()) as SaveWeeklyBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  if (!body.weekly) {
    return NextResponse.json({ error: "Mangler åpningstider." }, { status: 400 });
  }

  try {
    const weekly = await saveWeeklyHours(body.weekly);
    return NextResponse.json({ ok: true, weekly });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Kunne ikke lagre." }, { status: 400 });
  }
}
