import { NextRequest, NextResponse } from "next/server";
import { getVippsStatus, saveVippsWebhookSecret } from "@/lib/settings/vippsSettings";

export const dynamic = "force-dynamic";

interface Body {
  callbackUrl?: string;
}

/**
 * POST /api/admin/settings/vipps/webhook
 *
 * Registrerer webhook-endepunktet hos Vipps for nøklene som er lagret akkurat
 * nå, og lagrer secret-en som kommer tilbake (kryptert). Erstatter det
 * tidligere manuelle scripts/register-webhook.ts-steget for de som
 * konfigurerer Vipps via adminpanelet.
 */
export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  const url = body.callbackUrl?.trim();
  if (!url) {
    return NextResponse.json({ error: "Mangler callback-URL." }, { status: 400 });
  }

  try {
    const { registerWebhook, EPAYMENT_WEBHOOK_EVENTS } = await import("@/lib/payments/vipps");
    const result = await registerWebhook(url, [...EPAYMENT_WEBHOOK_EVENTS]);
    await saveVippsWebhookSecret(result.secret);
    const status = await getVippsStatus();
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Klarte ikke å registrere webhook." },
      { status: 400 }
    );
  }
}
