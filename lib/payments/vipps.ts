import "server-only";
import { randomUUID } from "node:crypto";
import { getVippsCredentials } from "@/lib/settings/vippsSettings";
import type { CreatePaymentInput, PaymentProvider } from "./types";

/**
 * Tynn klient mot Vipps MobilePay ePayment API + Webhooks API.
 *
 * Alt her kjører kun på serveren. client_secret og subscription key skal
 * aldri sendes til nettleseren.
 *
 * Nøklene hentes via lib/settings/vippsSettings.ts – enten satt av admin i
 * Innstillinger-panelet (lagret kryptert i databasen) eller, som fallback,
 * fra VIPPS_*-miljøvariabler.
 *
 * Dokumentasjon:
 * - ePayment API: https://developer.vippsmobilepay.com/docs/APIs/epayment-api/
 * - Webhooks API: https://developer.vippsmobilepay.com/docs/APIs/webhooks-api/
 */

async function vippsConfig() {
  const creds = await getVippsCredentials();
  if (!creds) {
    throw new Error(
      "Vipps er ikke satt opp ennå. Gå til Adminpanel → Innstillinger og lagre Vipps-nøklene (eller sett VIPPS_*-miljøvariablene)."
    );
  }
  return {
    baseUrl: creds.baseUrl,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    subscriptionKey: creds.subscriptionKey,
    msn: creds.msn,
    systemName: process.env.VIPPS_SYSTEM_NAME ?? "squash-booking-skiensgrane",
    systemVersion: process.env.VIPPS_SYSTEM_VERSION ?? "1.0.0",
  };
}

interface CachedToken {
  /** Bundet til hvilken client id token'et ble hentet med, slik at et nøkkelbytte i admin ikke risikerer å gjenbruke et token hentet med de gamle nøklene. */
  clientId: string;
  token: string;
  expiresAtMs: number;
}

let cachedToken: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  const cfg = await vippsConfig();

  if (cachedToken && cachedToken.clientId === cfg.clientId && cachedToken.expiresAtMs - now > 60_000) {
    return cachedToken.token;
  }

  const res = await fetch(`${cfg.baseUrl}/accesstoken/get`, {
    method: "POST",
    headers: {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      "Ocp-Apim-Subscription-Key": cfg.subscriptionKey,
      "Merchant-Serial-Number": cfg.msn,
    },
  });

  if (!res.ok) {
    throw new Error(`Klarte ikke å hente Vipps access token: ${res.status} ${await safeText(res)}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: string | number };
  const expiresInSeconds = Number(data.expires_in);
  cachedToken = { clientId: cfg.clientId, token: data.access_token, expiresAtMs: now + expiresInSeconds * 1000 };
  return cachedToken.token;
}

/**
 * Tester at nøklene som er lagret akkurat nå (DB eller env) faktisk fungerer,
 * ved å hente et ferskt access token. Brukes av "Test tilkobling" i admin-
 * panelet – lekker aldri selve nøklene tilbake, kun ok/feilmelding.
 */
export async function testVippsConnection(): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    cachedToken = null;
    await getAccessToken();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Ukjent feil." };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "(kunne ikke lese svarteksten)";
  }
}

async function vippsFetch<T>(
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {}
): Promise<T> {
  const { idempotencyKey, headers: initHeaders, ...restInit } = init;
  const cfg = await vippsConfig();
  const token = await getAccessToken();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Ocp-Apim-Subscription-Key": cfg.subscriptionKey,
    "Merchant-Serial-Number": cfg.msn,
    "Content-Type": "application/json",
    "Vipps-System-Name": cfg.systemName,
    "Vipps-System-Version": cfg.systemVersion,
    ...(initHeaders as Record<string, string> | undefined),
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${cfg.baseUrl}${path}`, { ...restInit, headers });

  if (!res.ok) {
    throw new VippsApiError(res.status, await safeText(res), path);
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export class VippsApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    public path: string
  ) {
    super(`Vipps API-feil ved ${path}: ${status} ${body}`);
    this.name = "VippsApiError";
  }
}

interface RawCreatePaymentResult {
  reference: string;
  redirectUrl: string;
}

/**
 * Vipps' ePayment API forventer `customer.phoneNumber` på fullt MSISDN-format
 * – landkode (47 for Norge) foran, uten "+" eller mellomrom, f.eks.
 * "4741422126" – IKKE bare de 8 sifrene uten landkode som resten av appen
 * bruker internt til visning/lagring (se kommentaren på CreatePaymentInput i
 * lib/payments/types.ts). Mangler landkoden avviser Vipps forespørselen med
 * en 400-feil, som før dukket opp for brukeren som den generiske
 * "Kunne ikke starte betaling akkurat nå" – uansett hvilket nummer som ble
 * brukt, siden ALLE ekte Vipps-betalinger traff denne.
 */
function toVippsPhoneNumber(nationalNumber: string): string {
  return `47${nationalNumber}`;
}

async function rawCreatePayment(input: CreatePaymentInput): Promise<RawCreatePaymentResult> {
  return vippsFetch<RawCreatePaymentResult>("/epayment/v1/payments", {
    method: "POST",
    idempotencyKey: input.reference,
    body: JSON.stringify({
      amount: { currency: "NOK", value: input.amountOre },
      paymentMethod: { type: "WALLET" },
      reference: input.reference,
      userFlow: "WEB_REDIRECT",
      returnUrl: input.returnUrl,
      paymentDescription: input.description,
      customer: { phoneNumber: toVippsPhoneNumber(input.phoneNumber) },
    }),
  });
}

export type VippsPaymentState = "CREATED" | "ABORTED" | "EXPIRED" | "AUTHORIZED" | "TERMINATED";

export interface VippsPayment {
  reference: string;
  state: VippsPaymentState;
  amount: { currency: string; value: number };
}

export async function getPayment(reference: string): Promise<VippsPayment> {
  return vippsFetch<VippsPayment>(`/epayment/v1/payments/${encodeURIComponent(reference)}`, {
    method: "GET",
  });
}

export async function capturePayment(reference: string, amountOre: number): Promise<void> {
  await vippsFetch(`/epayment/v1/payments/${encodeURIComponent(reference)}/capture`, {
    method: "POST",
    idempotencyKey: `${reference}-capture`,
    body: JSON.stringify({ modificationAmount: { currency: "NOK", value: amountOre } }),
  });
}

export async function refundPayment(reference: string, amountOre: number): Promise<void> {
  await vippsFetch(`/epayment/v1/payments/${encodeURIComponent(reference)}/refund`, {
    method: "POST",
    idempotencyKey: `${reference}-refund-${randomUUID()}`,
    body: JSON.stringify({ modificationAmount: { currency: "NOK", value: amountOre } }),
  });
}

/**
 * Registrerer et webhook-endepunkt hos Vipps. Kalles enten fra Innstillinger-
 * panelet (app/api/admin/settings/vipps/webhook/route.ts, anbefalt) eller
 * manuelt via scripts/register-webhook.ts – gjøres normalt kun én gang per
 * miljø (test/produksjon).
 */
export async function registerWebhook(url: string, events: string[]) {
  return vippsFetch<{ id: string; secret: string }>("/webhooks/v1/webhooks", {
    method: "POST",
    body: JSON.stringify({ url, events }),
  });
}

export const EPAYMENT_WEBHOOK_EVENTS = [
  "epayments.payment.authorized.v1",
  "epayments.payment.captured.v1",
  "epayments.payment.cancelled.v1",
  "epayments.payment.refunded.v1",
  "epayments.payment.aborted.v1",
  "epayments.payment.expired.v1",
  "epayments.payment.terminated.v1",
] as const;

export const vippsPaymentProvider: PaymentProvider = {
  async createPayment(input) {
    const result = await rawCreatePayment(input);
    return { redirectUrl: result.redirectUrl };
  },

  async reconcilePendingPayment({ reference, amountOre }) {
    const payment = await getPayment(reference);

    if (payment.state === "AUTHORIZED") {
      try {
        await capturePayment(reference, amountOre);
      } catch (err) {
        // Idempotency-Key beskytter mot dobbel fangst ved retries. I en
        // sjelden race kan capture allerede være utført av et samtidig kall
        // – vi logger og fortsetter uansett å regne betalingen som bekreftet,
        // siden AUTHORIZED i seg selv betyr at brukeren har godkjent den.
        console.error("[vipps] capture feilet (fortsetter likevel):", err);
      }
      return "confirmed";
    }

    if (payment.state === "ABORTED" || payment.state === "EXPIRED" || payment.state === "TERMINATED") {
      return "cancelled";
    }

    return "pending";
  },

  async refund(reference, amountOre) {
    await refundPayment(reference, amountOre);
  },
};
