import { NextRequest, NextResponse } from "next/server";
import { getActivePaymentProvider, getVippsCredentials } from "@/lib/settings/vippsSettings";
import { verifyVippsWebhookSignature } from "@/lib/webhookAuth";
import { reconcileBooking } from "@/lib/reconcile";

export const dynamic = "force-dynamic";

/**
 * POST /api/squash/vipps-webhook
 *
 * Kun relevant når PAYMENT_PROVIDER=vipps (ekte betaling). Mottar hendelser
 * fra Vipps (authorized/captured/cancelled/aborted/expired/refunded/
 * terminated – se scripts/register-webhook.ts for hvilke vi abonnerer på).
 *
 * Vi stoler ikke blindt på FELTENE i webhook-payloaden for å avgjøre om en
 * betaling er gyldig – kun på at signaturen beviser at kallet faktisk kommer
 * fra Vipps, og på referansen, som vi bruker til å hente den kanoniske
 * statusen direkte fra Vipps' API (se lib/reconcile.ts + lib/payments/vipps.ts).
 */
export async function POST(request: NextRequest) {
  if ((await getActivePaymentProvider()) !== "vipps") {
    return NextResponse.json({ error: "Ikke i bruk (Vipps er ikke aktivert)." }, { status: 404 });
  }

  const credentials = await getVippsCredentials();
  const secret = credentials?.webhookSecret;
  if (!secret) {
    console.error("[vipps-webhook] Webhook-secret mangler (er webhooken registrert i Innstillinger?).");
    return NextResponse.json({ error: "Serverkonfigurasjonsfeil." }, { status: 500 });
  }

  // Må leses som rå tekst FØR noe annet, ellers stemmer ikke
  // signaturverifiseringen (den hasher de eksakte byte'ene som ble sendt).
  const rawBody = await request.text();

  const isValid = verifyVippsWebhookSignature({
    method: request.method,
    url: request.url,
    rawBody,
    headers: request.headers,
    secret,
  });

  if (!isValid) {
    console.warn("[vipps-webhook] Avviste kall med ugyldig signatur.");
    return NextResponse.json({ error: "Ugyldig signatur." }, { status: 401 });
  }

  let payload: { reference?: string };
  try {
    payload = JSON.parse(rawBody) as { reference?: string };
  } catch {
    return NextResponse.json({ error: "Ugyldig JSON." }, { status: 400 });
  }

  if (!payload.reference) {
    return NextResponse.json({ error: "Mangler 'reference' i payload." }, { status: 400 });
  }

  try {
    await reconcileBooking(payload.reference);
  } catch (err) {
    console.error("[vipps-webhook] feil under avstemming:", err);
    return NextResponse.json({ error: "Intern feil." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
