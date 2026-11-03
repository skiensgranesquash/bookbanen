import "server-only";
import { getRepository } from "@/lib/db";
import { MAX_DAYS_AHEAD } from "@/lib/config";

/**
 * Hvor mange dager frem i tid en kunde har lov til å booke en enkelttime –
 * satt av klubben i adminpanelet (se
 * app/admin/opening-hours/OpeningHoursManager.tsx, kortet "Grense for
 * enkelttimer"). Lagret i den samme generiske nøkkel/verdi-
 * innstillingstabellen som resten av innstillingene (se
 * lib/settings/recurringLimit.ts for samme mønster).
 *
 * Dette var tidligere en HARDKODET konstant (MAX_DAYS_AHEAD i
 * lib/config.ts) som gjaldt for ALLE kall til GET /api/squash/availability
 * – inkludert når ADMIN selv henter ledige tider til sin egen manuelle
 * booking (se app/admin/BookingsInsights.tsx). Det gjorde at admin heller
 * ikke fikk booke lenger frem enn akkurat det kundene selv fikk, og dukket
 * opp som "stengt denne dagen" på alle datoer forbi grensen – selv om
 * banen i realiteten var åpen. Admin er nå UNNTATT denne grensen helt (se
 * app/api/squash/availability/route.ts, som gjenkjenner admins egen
 * innloggede sesjon og hopper over sjekken) – denne innstillingen gjelder
 * dermed KUN kundens egen, selvbetjente enkeltbooking på bookingsiden.
 *
 * `null`/ikke satt betyr "bruk MAX_DAYS_AHEAD" (dagens standardverdi,
 * 14 dager) – akkurat som før denne innstillingen fantes.
 */
const KEY = "singleBookingMaxDaysAhead";

/** Mest en enkelttime kan lov til å bookes – en romslig, men ikke ubegrenset, teknisk grense (~10 år) mot feilinntastinger. */
const MAX_ALLOWED_DAYS_AHEAD = 3650;

export async function getSingleBookingMaxDaysAhead(): Promise<number> {
  const repo = await getRepository();
  const raw = await repo.getSetting(KEY);
  if (!raw) return MAX_DAYS_AHEAD;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MAX_ALLOWED_DAYS_AHEAD ? n : MAX_DAYS_AHEAD;
}

/**
 * `days: null` fjerner innstillingen igjen (tilbake til MAX_DAYS_AHEAD).
 * Kaster med en norsk feilmelding ved et ugyldig antall.
 */
export async function saveSingleBookingMaxDaysAhead(days: number | null): Promise<number> {
  const repo = await getRepository();

  if (days === null) {
    await repo.setSetting(KEY, "");
    return MAX_DAYS_AHEAD;
  }

  if (!Number.isInteger(days) || days < 1 || days > MAX_ALLOWED_DAYS_AHEAD) {
    throw new Error(`Ugyldig antall dager (må være et helt tall mellom 1 og ${MAX_ALLOWED_DAYS_AHEAD}).`);
  }

  await repo.setSetting(KEY, String(days));
  return days;
}
