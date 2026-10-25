import "server-only";
import type { AdminRole } from "@/lib/db/types";

/**
 * Signert sesjonscookie for adminpanelet – uten NextAuth/Auth.js, og uten
 * `node:crypto`, slik at den samme koden kan kjøre både i vanlige
 * server-ruter OG i middleware.ts (som Next.js som standard kjører i
 * Edge-runtime, der `node:crypto` ikke er tilgjengelig). Web Crypto-API-et
 * (`crypto.subtle`) finnes derimot overalt: Node, Edge og nettleser.
 *
 * Cookien er `<base64url(JSON-payload)>.<base64url(HMAC-SHA256-signatur)>`.
 * Payload er ikke hemmelig (ikke passord der), men er signert slik at den
 * ikke kan forfalskes eller endres av brukeren – inkludert `role`-feltet, som
 * middleware.ts stoler på direkte UTEN et eget databaseoppslag for hver
 * forespørsel, nettopp fordi det ikke kan forfalskes.
 *
 * `import type` (ikke en vanlig import) for AdminRole under – fjernes helt av
 * TypeScript ved kompilering, så dette drar IKKE inn resten av lib/db i
 * Edge-bunten.
 */

export interface SessionPayload {
  sub: string; // admin-bruker-id
  email: string;
  name: string;
  /** "full" | "bookings_only" – se AdminRole i lib/db/types.ts og håndhevingen i middleware.ts. */
  role: AdminRole;
  exp: number; // unix-tid (sekunder) sesjonen utløper
}

export const SESSION_COOKIE_NAME = "admin_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 dager

function getSecretKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET mangler (sett en lang, tilfeldig streng i .env).");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Returtypen er eksplisitt `Uint8Array<ArrayBuffer>` (ikke bare `Uint8Array`)
 * siden nyere TypeScript ellers widener den bare aliasen til
 * `Uint8Array<ArrayBufferLike>` (som også dekker SharedArrayBuffer) –
 * `crypto.subtle.verify()` sitt `BufferSource`-parameter godtar ikke den
 * bredere typen. Verdien er uansett alltid et ekte, ikke-delt ArrayBuffer her
 * (opprettet rett over via `new Uint8Array(binary.length)`), så dette er kun
 * en presisering av typen, ingen endring i faktisk oppførsel.
 */
function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function createSessionCookieValue(user: {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}): Promise<string> {
  const payload: SessionPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  };

  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await getSecretKey();
  const signatureBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  return `${encoded}.${toBase64Url(signatureBytes)}`;
}

/**
 * KUN FOR LOKAL TESTING: sett ADMIN_AUTH_DISABLED=true i .env.local for å
 * slippe å logge inn i adminpanelet mens du tester. Alt som sjekker
 * innlogging (middleware.ts OG hver enkelt /api/admin/*-rute) går via denne
 * ene funksjonen, så dette ene stedet er nok til å slå av innlogging helt
 * – ingen separate "bypass"-brytere å huske å fjerne andre steder.
 *
 * To uavhengige sikkerhetsnett hindrer at dette ved et uhell blir stående
 * på i produksjon:
 *  1) NODE_ENV === "production" overstyrer alltid flagget (Next.js setter
 *     denne automatisk ved "next build"/"next start" – IKKE i "next dev").
 *  2) Flagget leses fra .env.local, som aldri følger med i den zippede
 *     koden som limes inn i hovedprosjektet – se README.
 * Fjern likevel linjen fra .env.local igjen når du er ferdig med å teste,
 * som en tredje sikkerhet.
 */
function isAdminAuthDisabledForLocalTesting(): boolean {
  return process.env.ADMIN_AUTH_DISABLED === "true" && process.env.NODE_ENV !== "production";
}

const TEST_SESSION: SessionPayload = {
  sub: "test-admin-lokal-testing",
  email: "test@lokal.test",
  name: "Test-admin (innlogging avslått – se .env.local)",
  role: "full",
  exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
};

export async function verifySessionCookieValue(
  value: string | undefined | null
): Promise<SessionPayload | null> {
  if (isAdminAuthDisabledForLocalTesting()) return TEST_SESSION;

  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;

  try {
    const key = await getSecretKey();
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(signature),
      new TextEncoder().encode(encoded)
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    // Eldre sesjonscookies (satt før `role`-feltet fantes) mangler feltet –
    // de regnes som fulle administratorer, akkurat som kontoen alltid har
    // vært. Cookien fornyes uansett med riktig rolle neste gang brukeren
    // logger inn på nytt (senest om 7 dager, se SESSION_MAX_AGE_SECONDS).
    if (!payload.role) payload.role = "full";
    return payload;
  } catch {
    return null;
  }
}
