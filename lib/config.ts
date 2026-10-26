/**
 * All banespesifikk konfigurasjon samlet ett sted. Siden klubben kun har
 * én squashbane, trenger vi ikke noe konsept for "flere ressurser" i
 * modellen – courtId er alltid "1".
 */

export const COURT_ID = "1";

/**
 * Fabrikk-standard åpningstid (lokal tid, Europe/Oslo), kun brukt som
 * forhåndsutfylt startverdi for ALLE ukedager FØR klubben har satt opp sine
 * egne åpningstider i adminpanelet (se lib/settings/openingHours.ts). Når
 * noen faktiske åpningstider er lagret der, styrer de – ikke disse to.
 */
export const OPENING_HOUR = 5; // 05:00
export const CLOSING_HOUR = 23; // 23:00

/** Lengde på ett "grid-rutenett"-tidsluke i kalenderen, i minutter – også den kortest mulige bookingen. */
export const SLOT_LENGTH_MINUTES = 30;

/**
 * En booking er enten 30 minutter (én rutenett-tidsluke) eller 1 time (to
 * påfølgende tidsluker) – kunden velger selv på bookingsiden hvilken av de
 * to når de trykker på et ledig klokkeslett (se BookingCalendar.tsx). Det
 * finnes ingen andre varigheter (f.eks. 90 minutter eller 2 timer).
 */
export const BOOKABLE_DURATIONS_MINUTES = [30, 60] as const;
export type BookingDurationMinutes = (typeof BOOKABLE_DURATIONS_MINUTES)[number];

export function isBookableDurationMinutes(value: unknown): value is BookingDurationMinutes {
  return typeof value === "number" && (BOOKABLE_DURATIONS_MINUTES as readonly number[]).includes(value);
}

/** Samme varighet uttrykt i antall rutenett-tidsluker (SLOT_LENGTH_MINUTES hver) – det tallet koden faktisk regner med internt (occurrenceRange osv). */
export function durationMinutesToSlots(durationMinutes: BookingDurationMinutes): number {
  return Math.round(durationMinutes / SLOT_LENGTH_MINUTES);
}

/** Maks antall uker en gjentakende (ukentlig) booking kan strekke seg over. */
export const MAX_RECURRING_WEEKS = 26;

/** Hvor mange dager frem i tid man kan booke en enkelttime. */
export const MAX_DAYS_AHEAD = 14;

/**
 * Hvor lenge et "pending"-hold (venter på betaling) holder av tiden(e) før
 * det frigis automatisk igjen. Hindrer at noen blokkerer baner uten å
 * fullføre betalingen.
 */
export const HOLD_MINUTES = 10;

export const TIME_ZONE = "Europe/Oslo";

export const CLUB_NAME = "IF Skiens Grane";
export const CLUB_ORG_NUMBER = "983972306";
export const VENUE_NAME = "Mova, Skien";

/**
 * Hvilken databasedriver som skal brukes:
 * - "local"    – JSON-fil på disk (data/db.json). Ingen eksterne kontoer,
 *                perfekt for lokal testing. IKKE egnet for produksjon
 *                (ingen ekte samtidighetssikring på tvers av flere
 *                serverinstanser, og filen bør ikke ligge i git).
 * - "supabase" – Postgres via Supabase. Brukes i produksjon.
 * Styres av miljøvariabelen DB_DRIVER, med "local" som standard slik at
 * appen fungerer med nullkonfigurasjon rett etter `npm install`.
 */
export function getDbDriver(): "local" | "supabase" {
  return process.env.DB_DRIVER === "supabase" ? "supabase" : "local";
}

/**
 * Hvilken betalingsleverandør som skal brukes:
 * - "mock"  – simulerer Vipps lokalt, med en egen side der du selv trykker
 *             "godkjenn"/"avbryt". Ingen nettverkskall, ingen ekte konto.
 * - "vipps" – ekte Vipps ePayment API (test- eller produksjonsmiljø).
 *
 * Dette er kun FALLBACK-verdien (miljøvariabelen PAYMENT_PROVIDER, "mock"
 * som standard). Den faktiske, gjeldende verdien styres normalt fra
 * Adminpanel → Innstillinger ("Aktiver Vipps") og lagres i databasen – se
 * lib/settings/vippsSettings.ts sin getActivePaymentProvider(), som denne
 * funksjonen kun brukes som reserve for.
 */
export function getPaymentProvider(): "mock" | "vipps" {
  return process.env.PAYMENT_PROVIDER === "vipps" ? "vipps" : "mock";
}
