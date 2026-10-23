import { NextRequest, NextResponse } from "next/server";
import { getVippsStatus, setActivePaymentProvider } from "@/lib/settings/vippsSettings";

export const dynamic = "force-dynamic";

interface Body {
  active?: boolean;
}

/**
 * POST /api/admin/settings/vipps/activate
 * Body: { active: boolean }
 *
 * Bytter mellom simulert Vipps-betaling ("mock", standard – trygt å teste
 * med) og ekte Vipps-betaling ("vipps", ekte penger). Krever at Vipps-
 * nøklene allerede er lagret.
 */
export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  try {
    await setActivePaymentProvider(body.active ? "vipps" : "mock");
    const status = await getVippsStatus();
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Kunne ikke endre." }, { status: 400 });
  }
}
