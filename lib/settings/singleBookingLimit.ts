import "server-only";
import { getRepository } from "@/lib/db";
import { maxBookableDate } from "@/lib/slots";
import { getRecurringCutoffDate } from "@/lib/settings/recurringLimit";

/**
 * Hvor mange dager frem i tid en kunde har lov til å booke en enkelttime –
 * satt av klubben i adminpanelet (se
 * app/admin/opening-hours/OpeningHoursManager.tsx, kortet "Grense for
 * enkelttimer"). Lagret i den samme generiske nøkkel/verdi-
 * innstillingstabellen som resten av innstillingene (se
 * lib/settings/recurringLimit.ts for samme mønster).
 *
 * `null`/ikke satt betyr at INGEN eksplisitt antall dager er valgt – da
 * gjelder i stedet datoen for siste seriebooking (recurringCutoffDate, se
 * lib/settings/recurringLimit.ts) som den faktiske grensen for
 * enkelttimer også, se getEffectiveSingleBookingMaxDate under. Det var
 * tidligere en HARDKODET konstant (MAX_DAYS_AHEAD i lib/config.ts, 14
 * dager) som gjaldt uansett – men siden en dag forbi et slikt vindu verken
 * er "stengt" eller gir mening som STRENGERE enn grensen en gjentakende
 * booking allerede har, er MAX_DAYS_AHEAD ikke lenger i bruk her i det
 * hele tatt.
 *
 * En "hovedadministrator" (rolle "full", se AdminRole i lib/db/types.ts)
 * er UNNTATT denne grensen helt når hen selv booker (se
 * app/api/squash/availability/route.ts). En begrenset "bookings_only"-
 * administrator er derimot bundet av samme grense som kunden.
 */
const KEY = "singleBookingMaxDaysAhead";

/** Mest en enkelttime kan ha lov til å bookes frem i tid – en romslig, men ikke ubegrenset, teknisk grense (~10 år) mot feilinntastinger. */
const MAX_ALLOWED_DAYS_AHEAD = 3650;

/**
 * Den rå, lagrede verdien – antall dager, eller `null` hvis feltet står
 * tomt (da brukes datoen for siste seriebooking i stedet, se
 * getEffectiveSingleBookingMaxDate under). Brukes KUN av selve
 * innstillingsskjemaet (se
 * app/api/admin/settings/single-booking-limit/route.ts) – all FAKTISK
 * håndheving av grensen skal bruke getEffectiveSingleBookingMaxDate, ikke
 * denne direkte.
 */
export async function getSingleBookingMaxDaysAhead(): Promise<number | null> {
  const repo = await getRepository();
  const raw = await repo.getSetting(KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MAX_ALLOWED_DAYS_AHEAD ? n : null;
}

/**
 * `days: null` fjerner innstillingen igjen (tilbake til "bruk datoen for
 * siste seriebooking"). Kaster med en norsk feilmelding ved et ugyldig
 * antall.
 */
export async function saveSingleBookingMaxDaysAhead(days: number | null): Promise<number | null> {
  const repo = await getRepository();

  if (days === null) {
    await repo.setSetting(KEY, "");
    return null;
  }

  if (!Number.isInteger(days) || days < 1 || days > MAX_ALLOWED_DAYS_AHEAD) {
    throw new Error(`Ugyldig antall dager (må være et helt tall mellom 1 og ${MAX_ALLOWED_DAYS_AHEAD}).`);
  }

  await repo.setSetting(KEY, String(days));
  return days;
}

/**
 * Den FAKTISKE siste datoen en enkelttime har lov til å bookes, som
 * "YYYY-MM-DD" – eller `null` for ingen grense i det hele tatt:
 *  1) Er et eksplisitt antall dager satt (se getSingleBookingMaxDaysAhead
 *     over)? Bruk det – i dag + det antallet dager.
 *  2) Ellers, er en siste dato for seriebookinger satt (recurringCutoffDate,
 *     se lib/settings/recurringLimit.ts)? Bruk DEN datoen direkte – det gir
 *     ingen mening at en enkelttime skal ha en STRENGERE grense enn en
 *     gjentakende booking allerede har.
 *  3) Ellers: ingen grense (`null`) – akkurat som en gjentakende booking
 *     uten satt cutoff-dato heller ikke har noen absolutt siste dato.
 */
export async function getEffectiveSingleBookingMaxDate(): Promise<string | null> {
  const [daysAhead, cutoffDate] = await Promise.all([getSingleBookingMaxDaysAhead(), getRecurringCutoffDate()]);
  if (daysAhead != null) return maxBookableDate(daysAhead);
  return cutoffDate;
}
