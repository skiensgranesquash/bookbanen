import "server-only";
import { getRepository } from "@/lib/db";
import { CLUB_NAME } from "@/lib/config";

/**
 * Klubbens eget navn og logo, satt via adminpanelet – lagret i den samme
 * generiske nøkkel/verdi-innstillingstabellen som Vipps-nøklene og
 * åpningstidene (se lib/settings/openingHours.ts for samme mønster).
 *
 * Logoet lagres som en data: URL (base64) RETT I innstillingsverdien, ikke
 * som en egen fil på disk/i en bøtte – det finnes ingen filopplasting/CDN i
 * denne appen ennå, og en data: URL fungerer identisk for BÅDE den lokale
 * JSON-fil-databasen og Supabase (det er uansett bare en tekststreng). Enkelt,
 * men begrenser logoet til noen få MB (se MAX_LOGO_BYTES) – fint for en liten
 * klubblogo, men ikke en løsning som skalerer til mange store bilder.
 *
 * `clubName` er tomt som standard (bruker CLUB_NAME fra lib/config.ts som
 * fabrikk-standard helt til noen faktisk har satt et eget navn), og
 * `logoDataUrl` er null som standard (da vises den medfølgende
 * public/logo-squash.jpg – se app/squash/booking/page.tsx).
 */

const CLUB_NAME_KEY = "brandingClubName";
const LOGO_KEY = "brandingLogoDataUrl";

export interface Branding {
  clubName: string;
  /** data:image/...;base64,... – eller null for å bruke standardlogoen. */
  logoDataUrl: string | null;
}

/** ~2 MB rått bilde (litt mer som base64) – rikelig for en logo, men lite nok til at det ikke blir et tungt innstillingsoppslag. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

export function isValidLogoDataUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return false;
  if (!ALLOWED_LOGO_TYPES.includes(match[1])) return false;

  // Grov størrelse ut fra lengden på selve base64-teksten (unngår å faktisk
  // dekode hele strengen bare for å sjekke størrelsen).
  const approxBytes = Math.ceil((match[2].length * 3) / 4);
  return approxBytes <= MAX_LOGO_BYTES;
}

export async function getBranding(): Promise<Branding> {
  const repo = await getRepository();
  const [storedName, storedLogo] = await Promise.all([repo.getSetting(CLUB_NAME_KEY), repo.getSetting(LOGO_KEY)]);
  return {
    clubName: storedName && storedName.trim() ? storedName : CLUB_NAME,
    logoDataUrl: storedLogo && storedLogo.trim() ? storedLogo : null,
  };
}

export interface SaveBrandingInput {
  /** Utelatt felt endrer ikke den lagrede verdien. */
  clubName?: string;
  /** `null` fjerner et eventuelt opplastet logo (tilbake til standardlogoen). Utelatt endrer ikke logoet. */
  logoDataUrl?: string | null;
}

/** Validerer og lagrer klubbnavn og/eller logo. Kaster med en norsk feilmelding ved ugyldige verdier. */
export async function saveBranding(input: SaveBrandingInput): Promise<Branding> {
  const repo = await getRepository();

  if (input.clubName !== undefined) {
    const trimmed = input.clubName.trim();
    if (trimmed.length < 2 || trimmed.length > 80) {
      throw new Error("Navnet må være mellom 2 og 80 tegn.");
    }
    await repo.setSetting(CLUB_NAME_KEY, trimmed);
  }

  if (input.logoDataUrl !== undefined) {
    if (input.logoDataUrl === null) {
      await repo.setSetting(LOGO_KEY, "");
    } else {
      if (!isValidLogoDataUrl(input.logoDataUrl)) {
        throw new Error("Ugyldig bildefil – bruk PNG, JPG, WebP eller SVG, maks 2 MB.");
      }
      await repo.setSetting(LOGO_KEY, input.logoDataUrl);
    }
  }

  return getBranding();
}
