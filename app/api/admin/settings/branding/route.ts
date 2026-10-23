import { NextRequest, NextResponse } from "next/server";
import { getBranding, saveBranding } from "@/lib/settings/branding";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/settings/branding – hent gjeldende klubbnavn og logo.
 * POST /api/admin/settings/branding – lagre klubbnavn og/eller logo.
 *
 * Beskyttet av middleware.ts som resten av /api/admin/** – krever gyldig
 * admin-sesjon.
 */
export async function GET() {
  try {
    const branding = await getBranding();
    return NextResponse.json(branding);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Kunne ikke hente innstillinger." },
      { status: 500 }
    );
  }
}

interface SaveBrandingBody {
  clubName?: string;
  /** Sett til null for å fjerne et opplastet logo (tilbake til standardlogoen). */
  logoDataUrl?: string | null;
}

export async function POST(request: NextRequest) {
  let body: SaveBrandingBody;
  try {
    body = (await request.json()) as SaveBrandingBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel (filen er kanskje for stor)." }, { status: 400 });
  }

  try {
    const branding = await saveBranding({ clubName: body.clubName, logoDataUrl: body.logoDataUrl });
    return NextResponse.json({ ok: true, ...branding });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Kunne ikke lagre." }, { status: 400 });
  }
}
