import "server-only";
import { getActivePaymentProvider } from "@/lib/settings/vippsSettings";
import type { PaymentProvider } from "./types";

/**
 * Velger betalingsleverandør. DB-innstillingen satt via adminpanelet
 * (Innstillinger → "Aktiver Vipps") har forrang; miljøvariabelen
 * PAYMENT_PROVIDER (lib/config.ts) er fallback for rene env-baserte oppsett.
 * lib/payments/vipps.ts importeres kun når den faktisk trengs, slik at
 * ekte Vipps-kode aldri kjører i lokal (mock) modus.
 */
let cached: PaymentProvider | null = null;
let cachedKind: "mock" | "vipps" | null = null;

export async function getPaymentProviderImpl(): Promise<PaymentProvider> {
  const kind = await getActivePaymentProvider();
  if (cached && cachedKind === kind) return cached;

  if (kind === "vipps") {
    const { vippsPaymentProvider } = await import("./vipps");
    cached = vippsPaymentProvider;
  } else {
    const { mockPaymentProvider } = await import("./mock");
    cached = mockPaymentProvider;
  }
  cachedKind = kind;
  return cached;
}
