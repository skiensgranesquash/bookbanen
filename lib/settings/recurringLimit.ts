import "server-only";
import { getRepository } from "@/lib/db";
import { isValidDateString } from "./openingHours";
import { MAX_RECURRING_WEEKS } from "@/lib/config";

/**
 * Siste dato en gjentakende (ukentlig) booking har lov til å dekke – satt av
 * klubben i adminpanelet (se app/admin/opening-hours/OpeningHoursManager.tsx,
 * kortet "Grense for gjentakende bookinger"). Lagret i den samme generiske
 * nøkkel/verdi-innstillingstabellen som resten av innstillingene (se
 * lib/settings/branding.ts for samme mønster).
 *
 * MAX_RECURRING_WEEKS (lib/config.ts) er fortsatt et absolutt, teknisk tak
 * (26 uker) uansett hva som skjer her – denne datoen er en EKSTRA,
 * klubbstyrt grense på toppen av det, typisk satt tidligere (f.eks. "ikke
 * lenger enn ut sesongen"). `null` betyr at ingen egen dato er satt – da
 * gjelder kun MAX_RECURRING_WEEKS, akkurat som før denne innstillingen
 * fantes.
 *
 * Selve håndhevingen skjer to steder:
 *  1) GET /api/squash/recurring-preview – ukene etter grensen vises som
 *     "stengt" i forhåndsvisningen kunden ser FØR betaling.
 *  2) POST /api/squash/bookings – avviser hele bookingen på nytt,
 *     uavhengig av klienten, hvis noen av ukene likevel skulle ligge forbi
 *     grensen (samme forsvar-i-dybden-prinsipp som resten av API-et).
 *
 * Admin varsles om denne datoen i adminpanelet (se AdminDashboard.tsx) – én
 * uke før den passerer, og hver dag etter at den har passert.
 */
const CUTOFF_DATE_KEY = "recurringBookingCutoffDate";

export async function getRecurringCutoffDate(): Promise<string | null> {
  const repo = await getRepository();
  const raw = await repo.getSetting(CUTOFF_DATE_KEY);
  return raw && isValidDateString(raw) ? raw : null;
}

/**
 * `dateStr: null` fjerner grensen igjen (tilbake til kun MAX_RECURRING_WEEKS).
 * Kaster med en norsk feilmelding ved en ugyldig dato.
 */
export async function saveRecurringCutoffDate(dateStr: string | null): Promise<string | null> {
  const repo = await getRepository();

  if (dateStr === null) {
    await repo.setSetting(CUTOFF_DATE_KEY, "");
    return null;
  }

  if (!isValidDateString(dateStr)) {
    throw new Error("Ugyldig dato (forventet format ÅÅÅÅ-MM-DD).");
  }

  await repo.setSetting(CUTOFF_DATE_KEY, dateStr);
  return dateStr;
}

/**
 * Maks antall uker en enkelt gjentakende serie har lov til å ha, satt av
 * klubben i adminpanelet (se app/admin/opening-hours/OpeningHoursManager.tsx,
 * kortet "Grense for gjentakende bookinger") - lagret på samme måte som
 * CUTOFF_DATE_KEY over. `null` betyr at ingen egen grense er satt - da
 * gjelder kun MAX_RECURRING_WEEKS (teknisk tak), akkurat som før denne
 * innstillingen fantes.
 *
 * Denne grensen og CUTOFF_DATE_KEY over er to UAVHENGIGE grenser som begge
 * gjelder samtidig - systemet bruker alltid den STRENGESTE av de to (se
 * maxRecurringWeeksUntil i lib/slots.ts), akkurat som MAX_RECURRING_WEEKS
 * uansett er et absolutt tak ingen av dem kan overstyre.
 */
const MAX_WEEKS_KEY = "recurringMaxWeeksLimit";

export async function getRecurringMaxWeeks(): Promise<number | null> {
  const repo = await getRepository();
  const raw = await repo.getSetting(MAX_WEEKS_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MAX_RECURRING_WEEKS ? n : null;
}

/**
 * `weeks: null` fjerner grensen igjen (tilbake til kun MAX_RECURRING_WEEKS).
 * Kaster med en norsk feilmelding ved et ugyldig antall.
 */
export async function saveRecurringMaxWeeks(weeks: number | null): Promise<number | null> {
  const repo = await getRepository();

  if (weeks === null) {
    await repo.setSetting(MAX_WEEKS_KEY, "");
    return null;
  }

  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_RECURRING_WEEKS) {
    throw new Error(`Ugyldig antall uker (må være et helt tall mellom 1 og ${MAX_RECURRING_WEEKS}).`);
  }

  await repo.setSetting(MAX_WEEKS_KEY, String(weeks));
  return weeks;
}
