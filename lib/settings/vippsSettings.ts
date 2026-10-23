import "server-only";
import { getRepository } from "@/lib/db";
import { decryptSecret, encryptSecret, isSettingsEncryptionConfigured } from "@/lib/secrets";

/**
 * Vipps-nøkler satt via adminpanelet (Innstillinger), lagret kryptert i
 * databasen. Dette gjør det mulig for klubben å sette opp/bytte Vipps-nøkler
 * selv, uten å be utvikleren endre miljøvariabler eller kode for hver
 * endring.
 *
 * Miljøvariablene VIPPS_* (se .env.example) fungerer fortsatt som en
 * fallback for rene, kodenære oppsett – men DB-lagrede verdier (satt her)
 * har alltid forrang når de finnes.
 */

export type VippsEnvironment = "test" | "production";

export interface VippsCredentials {
  environment: VippsEnvironment;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  subscriptionKey: string;
  msn: string;
  webhookSecret: string | null;
}

interface StoredVippsSettings {
  environment: VippsEnvironment;
  clientId: string;
  clientSecretEnc: string;
  subscriptionKeyEnc: string;
  msn: string;
  webhookSecretEnc: string | null;
  savedAt: string;
}

const CREDENTIALS_KEY = "vippsCredentials";
const ACTIVE_PROVIDER_KEY = "activePaymentProvider";

function baseUrlFor(environment: VippsEnvironment): string {
  return environment === "production" ? "https://api.vipps.no" : "https://apitest.vipps.no";
}

async function readStored(): Promise<StoredVippsSettings | null> {
  const repo = await getRepository();
  const raw = await repo.getSetting(CREDENTIALS_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as StoredVippsSettings;
}

async function writeStored(record: StoredVippsSettings): Promise<void> {
  const repo = await getRepository();
  await repo.setSetting(CREDENTIALS_KEY, JSON.stringify(record));
}

/**
 * Henter Vipps-nøklene som faktisk skal brukes akkurat nå. DB-lagrede
 * (satt via adminpanelet) har alltid forrang over miljøvariabler.
 */
export async function getVippsCredentials(): Promise<VippsCredentials | null> {
  const stored = await readStored();
  if (stored) {
    return {
      environment: stored.environment,
      baseUrl: baseUrlFor(stored.environment),
      clientId: stored.clientId,
      clientSecret: decryptSecret(stored.clientSecretEnc),
      subscriptionKey: decryptSecret(stored.subscriptionKeyEnc),
      msn: stored.msn,
      webhookSecret: stored.webhookSecretEnc ? decryptSecret(stored.webhookSecretEnc) : null,
    };
  }

  const { VIPPS_API_BASE_URL, VIPPS_CLIENT_ID, VIPPS_CLIENT_SECRET, VIPPS_SUBSCRIPTION_KEY, VIPPS_MSN, VIPPS_WEBHOOK_SECRET } =
    process.env;

  if (!VIPPS_CLIENT_ID || !VIPPS_CLIENT_SECRET || !VIPPS_SUBSCRIPTION_KEY || !VIPPS_MSN) {
    return null;
  }

  return {
    environment: (VIPPS_API_BASE_URL ?? "").includes("apitest") ? "test" : "production",
    baseUrl: (VIPPS_API_BASE_URL ?? "https://apitest.vipps.no").replace(/\/+$/, ""),
    clientId: VIPPS_CLIENT_ID,
    clientSecret: VIPPS_CLIENT_SECRET,
    subscriptionKey: VIPPS_SUBSCRIPTION_KEY,
    msn: VIPPS_MSN,
    webhookSecret: VIPPS_WEBHOOK_SECRET ?? null,
  };
}

export interface SaveVippsCredentialsInput {
  environment: VippsEnvironment;
  clientId: string;
  clientSecret: string;
  subscriptionKey: string;
  msn: string;
}

/**
 * Lagrer nye Vipps-nøkler (kryptert). Nullstiller IKKE en allerede
 * registrert webhook-secret – den henger sammen med URL-en som ble
 * registrert, ikke med client id/secret.
 */
export async function saveVippsCredentials(input: SaveVippsCredentialsInput): Promise<void> {
  if (!isSettingsEncryptionConfigured()) {
    throw new Error(
      "SETTINGS_ENCRYPTION_KEY er ikke satt opp på serveren ennå. Be utvikleren sette denne miljøvariabelen (kun én gang, se README) før Vipps-nøkler kan lagres her."
    );
  }
  if (!input.clientId.trim() || !input.clientSecret.trim() || !input.subscriptionKey.trim() || !input.msn.trim()) {
    throw new Error("Alle feltene må fylles ut.");
  }

  const existing = await readStored();

  await writeStored({
    environment: input.environment,
    clientId: input.clientId.trim(),
    clientSecretEnc: encryptSecret(input.clientSecret.trim()),
    subscriptionKeyEnc: encryptSecret(input.subscriptionKey.trim()),
    msn: input.msn.trim(),
    // Ny miljø/nøkkel-kombinasjon betyr som regel en annen webhook-
    // registrering også – nullstill for å unngå å stole på en secret fra en
    // annen salgsenhet/miljø ved en feil.
    webhookSecretEnc: existing && existing.environment === input.environment ? existing.webhookSecretEnc : null,
    savedAt: new Date().toISOString(),
  });
}

export async function saveVippsWebhookSecret(secret: string): Promise<void> {
  const existing = await readStored();
  if (!existing) throw new Error("Lagre Vipps-nøklene før du registrerer webhooken.");
  await writeStored({ ...existing, webhookSecretEnc: encryptSecret(secret) });
}

export interface VippsStatus {
  configured: boolean;
  environment: VippsEnvironment | null;
  clientIdMasked: string | null;
  msn: string | null;
  webhookRegistered: boolean;
  savedAt: string | null;
  active: boolean;
  encryptionReady: boolean;
}

function maskClientId(id: string): string {
  if (id.length <= 4) return "••••";
  return `•••• ${id.slice(-4)}`;
}

export async function getVippsStatus(): Promise<VippsStatus> {
  const stored = await readStored();
  const active = await getActivePaymentProvider();

  return {
    configured: !!stored,
    environment: stored?.environment ?? null,
    clientIdMasked: stored ? maskClientId(stored.clientId) : null,
    msn: stored?.msn ?? null,
    webhookRegistered: !!stored?.webhookSecretEnc,
    savedAt: stored?.savedAt ?? null,
    active: active === "vipps",
    encryptionReady: isSettingsEncryptionConfigured(),
  };
}

/** Hvilken betalingsleverandør som er aktiv. DB-innstillingen (satt via adminpanelet) har forrang over miljøvariabelen PAYMENT_PROVIDER. */
export async function getActivePaymentProvider(): Promise<"mock" | "vipps"> {
  const repo = await getRepository();
  const stored = await repo.getSetting(ACTIVE_PROVIDER_KEY);
  if (stored === "vipps" || stored === "mock") return stored;

  const { getPaymentProvider } = await import("@/lib/config");
  return getPaymentProvider();
}

export async function setActivePaymentProvider(next: "mock" | "vipps"): Promise<void> {
  if (next === "vipps") {
    const stored = await readStored();
    if (!stored) throw new Error("Lagre Vipps-nøklene før du aktiverer ekte Vipps-betaling.");
  }
  const repo = await getRepository();
  await repo.setSetting(ACTIVE_PROVIDER_KEY, next);
}
