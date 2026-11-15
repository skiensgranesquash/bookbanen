import { NextRequest, NextResponse } from "next/server";
import { getTournamentSettings, saveTournamentSettings, type TournamentSettings } from "@/lib/settings/tournament";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/settings/tournament – hent dagens turneringsinnstillinger
 *      (kode, av/på, utløpsdato).
 * POST /api/admin/settings/tournament – lagre alle tre på nytt (sendes
 *      alltid samlet fra adminpanelets skjema, se TournamentManager.tsx).
 *
 * Beskyttet av middleware.ts – IKKE i noen av BOOKINGS_ONLY_ALLOWED_*-listene
 * der, så en begrenset ("bookings_only") administrator nektes automatisk,
 * akkurat som resten av Oppsett/Vipps/Utseende.
 */
export async function GET() {
  try {
    const settings = await getTournamentSettings();
    return NextResponse.json(settings);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Kunne ikke hente turneringsinnstillinger." },
      { status: 500 }
    );
  }
}

interface SaveBody {
  code?: string;
  active?: boolean;
  expiresAt?: string | null;
}

export async function POST(request: NextRequest) {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  try {
    const input: TournamentSettings = {
      code: typeof body.code === "string" ? body.code : "",
      active: body.active === true,
      expiresAt: body.expiresAt ? body.expiresAt : null,
    };
    const saved = await saveTournamentSettings(input);
    return NextResponse.json({ ok: true, ...saved });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Kunne ikke lagre." }, { status: 400 });
  }
}
