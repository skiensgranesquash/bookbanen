import { NextRequest, NextResponse } from "next/server";
import { getVippsStatus, saveVippsCredentials, type VippsEnvironment } from "@/lib/settings/vippsSettings";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/settings/vipps  – status (ALDRI selve nøklene, kun maskert info).
 * POST /api/admin/settings/vipps  – lagre nye Vipps-nøkler (krypteres før lagring).
 *
 * Beskyttet av middleware.ts som resten av /api/admin/** – krever gyldig
 * admin-sesjon.
 */
export async function GET() {
  try {
    const status = await getVippsStatus();
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Kunne ikke hente status." },
      { status: 500 }
    );
  }
}

interface SaveBody {
  environment?: VippsEnvironment;
  clientId?: string;
  clientSecret?: string;
  subscriptionKey?: string;
  msn?: string;
}

export async function POST(request: NextRequest) {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  if (body.environment !== "test" && body.environment !== "production") {
    return NextResponse.json({ error: "Velg miljø (test eller produksjon)." }, { status: 400 });
  }

  try {
    await saveVippsCredentials({
      environment: body.environment,
      clientId: body.clientId ?? "",
      clientSecret: body.clientSecret ?? "",
      subscriptionKey: body.subscriptionKey ?? "",
      msn: body.msn ?? "",
    });
    const status = await getVippsStatus();
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Kunne ikke lagre." }, { status: 400 });
  }
}
