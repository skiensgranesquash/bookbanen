import { NextRequest, NextResponse } from "next/server";
import { getPricingSettings, savePricingSettings } from "@/lib/settings/pricing";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/settings/price – hent dagens priser (i øre) for 30 minutter og 1 time.
 * POST /api/admin/settings/price – sett nye priser (i øre) for begge, helt uavhengig av hverandre.
 *
 * Beskyttet av middleware.ts som resten av /api/admin/** – krever gyldig admin-sesjon.
 */
export async function GET() {
  try {
    const pricing = await getPricingSettings();
    return NextResponse.json(pricing);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Kunne ikke hente priser." },
      { status: 500 }
    );
  }
}

interface SaveBody {
  price30MinOre?: number;
  price60MinOre?: number;
}

export async function POST(request: NextRequest) {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  try {
    const pricing = await savePricingSettings({
      price30MinOre: Math.round(Number(body.price30MinOre)),
      price60MinOre: Math.round(Number(body.price60MinOre)),
    });
    return NextResponse.json({ ok: true, ...pricing });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Kunne ikke lagre." }, { status: 400 });
  }
}
