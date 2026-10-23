import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { expireStaleHolds } from "@/lib/holds";
import { COURT_ID, SLOT_LENGTH_MINUTES } from "@/lib/config";
import { getEffectiveHoursForDate } from "@/lib/settings/openingHours";
import { generateSlotsForDate, isDateBookable, isValidBookingDateString } from "@/lib/slots";

export const dynamic = "force-dynamic";

/**
 * GET /api/squash/availability?date=YYYY-MM-DD
 *
 * Returnerer alle 30-minutters rutenett-tidsluker for den gitte dagen og om
 * de er ledige. Leser ALDRI ut navn/telefon her – kun tidspunkt og en boolsk
 * "available", slik at dette endepunktet trygt kan være åpent/offentlig.
 *
 * Hver booking er alltid nøyaktig 1 time (se BOOKING_DURATION_SLOTS i
 * lib/config.ts), og hver returnert slot sitt eget `available`-flagg dekker
 * allerede hele denne timen – klienten trenger ikke slå opp "neste" slot for
 * å avgjøre om en hel, sammenhengende time er ledig fra et gitt starttidspunkt
 * (se lib/slots.ts – generateSlotsForDate). Denne ruten filtrerer IKKE bort
 * tider som er passert "nå" – det er bevisst en ren tidspunkt/ledighet-sjekk,
 * mens "er dette i fortiden"-sjekken gjøres med brukerens egen klokke i
 * BookingCalendar.tsx (og håndheves uansett på nytt server-side ved selve
 * bookingen, se app/api/squash/bookings/route.ts).
 *
 * Hver IKKE-ledig slot får også en `reason`:
 * - "booked":   denne halvtimen er FYSISK opptatt – den overlapper faktisk
 *   en aktiv bookings egne tidsrom (f.eks. en booking kl. 09:30–10:30 gjør at
 *   BÅDE 09:30- og 10:00-cellene får "booked", siden banen fysisk er i bruk
 *   hele den tiden). Vises rødt, og sammenhengende "booked"-celler flyter
 *   visuelt sammen til én blokk i UI-et (se BookingCalendar.tsx).
 * - "adjacent": denne halvtimen er selv fysisk LEDIG, men en ny hel time kan
 *   ikke STARTE akkurat her uten å krysse inn i en nabobooking (f.eks. banen
 *   nevnt over gjør også at 09:00 blir utilgjengelig som starttidspunkt, selv
 *   om 09:00–09:30 i seg selv ikke er opptatt av noen). Vises grått (som
 *   passerte tidspunkter), IKKE rødt – det er ingen som faktisk har tatt
 *   akkurat denne halvtimen.
 */
export async function GET(request: NextRequest) {
  const dateStr = request.nextUrl.searchParams.get("date");

  if (!dateStr || !isValidBookingDateString(dateStr)) {
    return NextResponse.json(
      { error: "Ugyldig eller manglende 'date'-parameter (forventet format YYYY-MM-DD)." },
      { status: 400 }
    );
  }

  if (!isDateBookable(dateStr)) {
    return NextResponse.json({ date: dateStr, slots: [], closed: true, note: null });
  }

  const hours = await getEffectiveHoursForDate(dateStr);
  if (hours.closed) {
    return NextResponse.json({ date: dateStr, slots: [], closed: true, note: hours.note });
  }

  try {
    await expireStaleHolds();
  } catch (err) {
    console.error("[availability] kunne ikke rydde opp utløpte holds:", err);
  }

  const slots = generateSlotsForDate(dateStr, hours.intervals);
  if (slots.length === 0) {
    return NextResponse.json({ date: dateStr, slots: [], closed: false, note: hours.note });
  }

  const repo = await getRepository();
  const ranges = slots.map((s) => ({
    startTime: s.startTime.toISOString(),
    endTime: s.endTime.toISOString(),
  }));

  let conflicts: typeof ranges = [];
  try {
    conflicts = await repo.findConflicts(COURT_ID, ranges);
  } catch (err) {
    console.error("[availability] databasefeil:", err);
    return NextResponse.json({ error: "Kunne ikke hente tilgjengelighet akkurat nå." }, { status: 500 });
  }

  const takenStartTimes = new Set(conflicts.map((c) => c.startTime));

  // Henter de FAKTISKE aktive bookingenes egne tidsrom (aldri navn/telefon –
  // kun tidspunkt, se kommentaren øverst) for å kunne avgjøre, PER
  // rutenett-halvtime, om akkurat DEN halvtimen fysisk overlapper en ekte
  // booking – ikke bare om denne halvtimens EGEN hypotetiske hel-time-økt
  // ville overlappet (det er `available`/`takenStartTimes` over).
  const activeRanges: { start: number; end: number }[] = [];
  try {
    const groups = await repo.listGroups({ fromDate: dateStr, toDate: dateStr });
    const ACTIVE_STATUSES = new Set(["pending", "confirmed"]);
    for (const group of groups) {
      if (!ACTIVE_STATUSES.has(group.status)) continue;
      for (const slot of group.slots) {
        if (slot.courtId === COURT_ID) {
          activeRanges.push({ start: new Date(slot.startTime).getTime(), end: new Date(slot.endTime).getTime() });
        }
      }
    }
  } catch (err) {
    // Ikke kritisk – uten dette faller vi bare tilbake til å vise ALLE
    // ikke-ledige tider som "booked" (rødt), slik ruten alltid har gjort.
    console.error("[availability] kunne ikke hente bookede tidsrom (viser uansett riktig ledighet):", err);
  }

  const slotLengthMs = SLOT_LENGTH_MINUTES * 60_000;

  return NextResponse.json({
    date: dateStr,
    closed: false,
    note: hours.note,
    slots: slots.map((slot) => {
      const iso = slot.startTime.toISOString();
      const available = !takenStartTimes.has(iso);
      const slotStartMs = slot.startTime.getTime();
      const slotEndMs = slotStartMs + slotLengthMs;
      const occupied = activeRanges.some((r) => slotStartMs < r.end && slotEndMs > r.start);
      return {
        startTime: iso,
        endTime: slot.endTime.toISOString(),
        label: slot.label,
        available,
        reason: available ? undefined : occupied ? "booked" : "adjacent",
      };
    }),
  });
}
