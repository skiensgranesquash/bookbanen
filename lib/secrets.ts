import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Generisk kryptering-i-hvile for sensitive innstillinger som lagres i
 * databasen (i dag: Vipps client secret + subscription key + webhook
 * secret, se lib/settings/vippsSettings.ts).
 *
 * Nøkkelen (SETTINGS_ENCRYPTION_KEY) er en 32-byte (64 hex-tegn) tilfeldig
 * verdi som KUN finnes som miljøvariabel – aldri i databasen. Genereres én
 * gang av utvikleren med `openssl rand -hex 32` og settes i drifts-
 * miljøet (Vercel), akkurat som SESSION_SECRET.
 *
 * Hvorfor denne ekstra krypteringen, når databasen allerede kun er
 * tilgjengelig for tjeneren (service-role-nøkkelen, server-only)? Fordi det
 * gir et ekstra lag: selv om databasen en dag skulle bli lest av noen andre
 * enn appen selv (f.eks. en utvikler med tilgang til Supabase-dashbordet, en
 * feilkonfigurert backup, eller en fremtidig kodefeil som eksponerer for mye
 * i et admin-endepunkt), er Vipps-hemmelighetene fortsatt ikke lesbare uten
 * OGSÅ å ha SETTINGS_ENCRYPTION_KEY – som lever et helt annet sted
 * (drifts-/CI-miljøet), ikke i databasen.
 */

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const hex = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "SETTINGS_ENCRYPTION_KEY mangler. Be utvikleren generere én med `openssl rand -hex 32` og sette den som miljøvariabel (kun én gang – se README)."
    );
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error(
      "SETTINGS_ENCRYPTION_KEY må være nøyaktig 64 hex-tegn (32 byte). Generer på nytt med `openssl rand -hex 32`."
    );
  }
  return key;
}

/** true hvis SETTINGS_ENCRYPTION_KEY er satt og gyldig – trygt å kalle uten å risikere en kastet feil. */
export function isSettingsEncryptionConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

/** Krypterer en tekststreng. Returnerer "<iv>.<authTag>.<ciphertext>" (alle base64). */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

/** Dekrypterer en verdi produsert av encryptSecret. Kaster hvis nøkkelen er feil eller verdien er tuklet med. */
export function decryptSecret(stored: string): string {
  const key = getKey();
  const parts = stored.split(".");
  if (parts.length !== 3) throw new Error("Ugyldig kryptert verdi (feil format).");
  const [ivB64, tagB64, dataB64] = parts;

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString("utf8");
}
