import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/settings/vipps/test
 *
 * Tester nøklene som er lagret akkurat nå (henter et ferskt access token fra
 * Vipps). Lekker aldri nøklene selv – kun ok/feilmelding.
 */
export async function POST() {
  try {
    const { testVippsConnection } = await import("@/lib/payments/vipps");
    const result = await testVippsConnection();
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Ukjent feil." },
      { status: 400 }
    );
  }
}
