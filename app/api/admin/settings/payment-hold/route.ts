import { NextRequest, NextResponse } from "next/server";
import { getAdminPaymentRequestHoldMinutes, saveAdminPaymentRequestHoldMinutes } from "@/lib/settings/adminPaymentHold";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/settings/payment-hold - hent antall minutter en
 *      admin-sendt betalingsforespørsel holdes av før den frigjøres igjen.
 * POST /api/admin/settings/payment-hold - sett et nytt antall minutter.
 *
 * Beskyttet av middleware.ts som resten av /api/admin/** - krever gyldig
 * admin-sesjon. Se lib/settings/adminPaymentHold.ts for selve lagringen.
 */
export async function GET() {
  try {
    const minutes = await getAdminPaymentRequestHoldMinutes();
    return NextResponse.json({ minutes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Kunne ikke hente innstillingen." },
      { status: 500 }
    );
  }
}

interface SaveBody {
  minutes?: number;
}

export async function POST(request: NextRequest) {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  try {
    const minutes = await saveAdminPaymentRequestHoldMinutes(Number(body.minutes));
    return NextResponse.json({ ok: true, minutes });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Kunne ikke lagre." }, { status: 400 });
  }
}
