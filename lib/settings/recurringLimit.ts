import "server-only";
import { getRepository } from "@/lib/db";
import { isValidDateString } from "./openingHours";

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
