import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { expireStaleHolds } from "@/lib/holds";
import { BOOKING_DURATION_SLOTS, COURT_ID, MAX_RECURRING_WEEKS, PRICE_PER_SLOT_ORE } from "@/lib/config";
import { effectiveHoursForDate, getHoursContext } from "@/lib/settings/openingHours";
import { getRecurringCutoffDate } from "@/lib/settings/recurringLimit";
import {
  generateWeeklyDates,
  isWithinOpeningHours,
  isValidBookingDateString,
  occurrenceRange,
  todayInClubTimeZone,
} from "@/lib/slots";

export const dynamic = "force-dynamic";

/**
 * GET /api/squash/recurring-preview?date=YYYY-MM-DD&time=HH:mm&weeks=8
 *
 * Regner ut alle datoene en gjentakende ukentlig booking ville dekket, og om
 * hver av dem faktisk er ledig – slik at brukeren kan se hele rekken og
 * eventuelle konflikter FØR de starter en betaling. Den ekte sjekken (som
 * hindrer race conditions, OG som på nytt sjekker grensen under) skjer
 * uansett på nytt, atomisk, når bookingen faktisk opprettes i
 * POST /api/squash/bookings.
 *
 * Varigheten er alltid nøyaktig BOOKING_DURATION_SLOTS (1 time) og tas
 * bevisst ALDRI imot som query-parameter – samme begrunnelse som i
 * POST /api/squash/bookings.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const date = params.get("date") ?? "";
  const time = params.get("time") ?? "";
  const durationSlots = BOOKING_DURATION_SLOTS;
  const weeks = Number(params.get("weeks") ?? "1");

  if (!isValidBookingDateString(date) || date < todayInClubTimeZone()) {
    return NextResponse.json({ error: "Ugyldig startdato." }, { status: 400 });
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return NextResponse.json({ error: "Ugyldig klokkeslett." }, { status: 400 });
  }
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_RECURRING_WEEKS) {
    return NextResponse.json({ error: `Antall uker må være mellom 1 og ${MAX_RECURRING_WEEKS}.` }, { status: 400 });
  }

  try {
    await expireStaleHolds();
  } catch (err) {
    console.error("[recurring-preview] kunne ikke rydde opp utløpte holds:", err);
  }

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
  const [hoursContext, cutoffDate] = await Promise.all([getHoursContext(), getRecurringCutoffDate()]);

  const repo = await getRepository();
  const ranges = validOccurrences.map((o) => ({
    startTime: o.range.startTime.toISOString(),
    endTime: o.range.endTime.toISOString(),
  }));
  const conflicts = await repo.findConflicts(COURT_ID, ranges);
  const conflictStartTimes = new Set(conflicts.map((c) => c.startTime));

  const occurrenceResults = validOccurrences.map((o) => {
    const hours = effectiveHoursForDate(o.date, hoursContext);
    const withinHours = isWithinOpeningHours(o.range.startTime, o.range.endTime, hours);
    const taken = conflictStartTimes.has(o.range.startTime.toISOString());
    const beyondCutoff = !!cutoffDate && o.date > cutoffDate;
    const closed = !withinHours || beyondCutoff;

    return {
      date: o.date,
      startTime: o.range.startTime.toISOString(),
      endTime: o.range.endTime.toISOString(),
      available: closed ? false : !taken,
      reason: closed ? ("closed" as const) : taken ? ("taken" as const) : null,
      note: beyondCutoff ? "Etter siste dato for gjentakende bookinger (satt av klubben)" : !withinHours ? hours.note : null,
    };
  });

  const allAvailable = occurrenceResults.every((o) => o.available);

  return NextResponse.json({
    occurrences: occurrenceResults,
    allAvailable,
    totalAmountOre: PRICE_PER_SLOT_ORE * durationSlots * occurrenceResults.length,
  });
}
