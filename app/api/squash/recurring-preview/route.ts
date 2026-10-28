import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { expireStaleHolds } from "@/lib/holds";
import { COURT_ID, durationMinutesToSlots, isBookableDurationMinutes, MAX_RECURRING_WEEKS } from "@/lib/config";
import { effectiveHoursForDate, getHoursContext } from "@/lib/settings/openingHours";
import { getPricingSettings, priceForDuration } from "@/lib/settings/pricing";
import { getRecurringCutoffDate, getRecurringMaxWeeks } from "@/lib/settings/recurringLimit";
import {
  generateWeeklyDates,
  isWithinOpeningHours,
  isValidBookingDateString,
  maxRecurringWeeksUntil,
  occurrenceRange,
  todayInClubTimeZone,
} from "@/lib/slots";

export const dynamic = "force-dynamic";

/**
 * GET /api/squash/recurring-preview?date=YYYY-MM-DD&time=HH:mm&weeks=8&duration=60
 *
 * Regner ut alle datoene en gjentakende ukentlig booking ville dekket, og om
 * hver av dem faktisk er ledig – slik at brukeren kan se hele rekken og
 * eventuelle konflikter FØR de starter en betaling. Den ekte sjekken (som
 * hindrer race conditions, OG som på nytt sjekker grensen under) skjer
 * uansett på nytt, atomisk, når bookingen faktisk opprettes i
 * POST /api/squash/bookings.
 *
 * `duration` må være 30 eller 60 (minutter) – samme varighet brukes for ALLE
 * forekomstene i rekken.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const date = params.get("date") ?? "";
  const time = params.get("time") ?? "";
  const weeks = Number(params.get("weeks") ?? "1");
  const durationParam = Number(params.get("duration"));

  if (!isValidBookingDateString(date) || date < todayInClubTimeZone()) {
    return NextResponse.json({ error: "Ugyldig startdato." }, { status: 400 });
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return NextResponse.json({ error: "Ugyldig klokkeslett." }, { status: 400 });
  }
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_RECURRING_WEEKS) {
    return NextResponse.json({ error: `Antall uker må være mellom 1 og ${MAX_RECURRING_WEEKS}.` }, { status: 400 });
  }
  if (!isBookableDurationMinutes(durationParam)) {
    return NextResponse.json({ error: "Ugyldig varighet – må være 30 eller 60 minutter." }, { status: 400 });
  }
  const duration = durationParam;
  const durationSlots = durationMinutesToSlots(duration);

  // Starter oppryddingen av utløpte holds med én gang, SAMTIDIG med (ikke
  // etter) de uavhengige oppslagene lenger ned – se samme resonnement i
  // app/api/squash/availability/route.ts. Ventes først inn rett før
  // findConflicts under, som er den eneste av dem som faktisk trenger at
  // den er ferdig.
  const holdsCleanupPromise = expireStaleHolds().catch((err) => {
    console.error("[recurring-preview] kunne ikke rydde opp utløpte holds:", err);
  });

  const dates = generateWeeklyDates(date, weeks);
  const occurrences = dates.map((d) => ({ date: d, range: occurrenceRange(d, time, durationSlots) }));

  // Et klokkeslett som ikke finnes i rutenettet i det hele tatt (ugyldig
  // "HH:mm") er en ekte feil – det skal aldri kunne skje fra UI-et, men vi
  // sjekker likevel. Om en gitt uke derimot er STENGT (ukedagens standard
  // eller en ferie/annerledesdag) eller ligger forbi klubbens egen grense
  // for gjentakende bookinger (se lib/settings/recurringLimit.ts), er ikke
  // det en feil i forespørselen – det er bare én av ukene som ikke er
  // tilgjengelig, akkurat som når en uke allerede er opptatt. Hver dato kan
  // ha sine EGNE åpningstider, så vi slår opp alt i ett oppslag i stedet for
  // én global åpningstid for alle ukene.
  if (occurrences.some((o) => !o.range)) {
    return NextResponse.json({ error: "Ugyldig klokkeslett." }, { status: 400 });
  }

  const validOccurrences = occurrences as Array<{ date: string; range: { startTime: Date; endTime: Date } }>;
  // Pricing hentes her, SAMMEN med de to andre uavhengige oppslagene, i
  // stedet for helt til slutt (som før) – den trengs jo ikke før selve
  // totalbeløpet skal regnes ut lenger ned, men den var uansett helt
  // uavhengig av både konflikt-sjekken og åpningstid/grense-oppslagene, så
  // å vente med å STARTE den til etter alt annet var bare bortkastet tid.
  const [hoursContext, cutoffDate, maxWeeksSetting, pricing] = await Promise.all([
    getHoursContext(),
    getRecurringCutoffDate(),
    getRecurringMaxWeeks(),
    getPricingSettings(),
  ]);
  const maxWeeksEffective = maxRecurringWeeksUntil(date, cutoffDate, maxWeeksSetting);

  const repo = await getRepository();
  const ranges = validOccurrences.map((o) => ({
    startTime: o.range.startTime.toISOString(),
    endTime: o.range.endTime.toISOString(),
  }));
  await holdsCleanupPromise;
  const conflicts = await repo.findConflicts(COURT_ID, ranges);
  const conflictStartTimes = new Set(conflicts.map((c) => c.startTime));

  const occurrenceResults = validOccurrences.map((o, i) => {
    const hours = effectiveHoursForDate(o.date, hoursContext);
    const withinHours = isWithinOpeningHours(o.range.startTime, o.range.endTime, hours);
    const taken = conflictStartTimes.has(o.range.startTime.toISOString());
    const beyondLimit = i >= maxWeeksEffective;
    const closed = !withinHours || beyondLimit;

    return {
      date: o.date,
      startTime: o.range.startTime.toISOString(),
      endTime: o.range.endTime.toISOString(),
      available: closed ? false : !taken,
      reason: closed ? ("closed" as const) : taken ? ("taken" as const) : null,
      note: beyondLimit ? "Etter grensen for gjentakende bookinger (satt av klubben)" : !withinHours ? hours.note : null,
    };
  });

  const allAvailable = occurrenceResults.every((o) => o.available);

  return NextResponse.json({
    occurrences: occurrenceResults,
    allAvailable,
    totalAmountOre: priceForDuration(pricing, duration) * occurrenceResults.length,
  });
}
