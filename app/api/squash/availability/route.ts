import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { expireStaleHolds } from "@/lib/holds";
import { COURT_ID } from "@/lib/config";
import { SESSION_COOKIE_NAME, verifySessionCookieValue } from "@/lib/auth/session";
import { getEffectiveHoursForDate } from "@/lib/settings/openingHours";
import { getEffectiveSingleBookingMaxDate } from "@/lib/settings/singleBookingLimit";
import { generateSlotsForDate, isValidBookingDateString, todayInClubTimeZone } from "@/lib/slots";

export const dynamic = "force-dynamic";

/**
 * GET /api/squash/availability?date=YYYY-MM-DD
 *
 * Returnerer alle 30-minutters rutenett-tidsluker for den gitte dagen og om
 * de er ledige. Leser ALDRI ut navn/telefon her – kun tidspunkt og en boolsk
 * "available", slik at dette endepunktet trygt kan være åpent/offentlig.
 *
 * Siden en booking nå kan være 30 minutter ELLER 1 time (se
 * BOOKABLE_DURATIONS_MINUTES i lib/config.ts), er hver returnert slot en REN,
 * fysisk halvtime (se lib/slots.ts – generateSlotsForDate) – `available`
 * betyr "akkurat denne halvtimen er fysisk ledig", ikke "en hel time kan
 * starte her". Denne ruten filtrerer IKKE bort tider som er passert "nå" –
 * det er bevisst en ren tidspunkt/ledighet-sjekk, mens "er dette i
 * fortiden"-sjekken gjøres med brukerens egen klokke i BookingCalendar.tsx
 * (og håndheves uansett på nytt server-side ved selve bookingen, se
 * app/api/squash/bookings/route.ts).
 *
 * Hver IKKE-ledig slot får `reason: "booked"` – den overlapper faktisk en
 * aktiv bookings eget tidsrom (en flertimers booking dekker flere
 * påfølgende halvtimer, som da alle får "booked"). Vises rødt, og
 * sammenhengende "booked"-celler flyter visuelt sammen til én blokk i UI-et
 * (se BookingCalendar.tsx).
 *
 * I tillegg får HVER slot et `canExtendToHour`-flagg: om en hel, bookbar
 * time kan starte akkurat her – altså at BÅDE denne og den (kronologisk)
 * påfølgende halvtimen selv er `available`. Brukes av bookingsiden til å
 * vise/skru på "1 time"-valget når kunden har trykket på et klokkeslett (se
 * BookingCalendar.tsx), og av adminpanelets manuelle booking (som alltid
 * booker en fast 1-times økt) til å gråe ut halvtimer der det ikke er plass
 * til en hel time (se app/admin/BookingsInsights.tsx).
 */
export async function GET(request: NextRequest) {
  const dateStr = request.nextUrl.searchParams.get("date");

  if (!dateStr || !isValidBookingDateString(dateStr)) {
    return NextResponse.json(
      { error: "Ugyldig eller manglende 'date'-parameter (forventet format YYYY-MM-DD)." },
      { status: 400 }
    );
  }

  // En "hovedadministrator" (rolle "full", se AdminRole i lib/db/types.ts)
  // sin EGEN innloggede sesjon er UNNTATT grensen under helt – den gjelder
  // kun kundens selvbetjente enkeltbooking på bookingsiden (og en begrenset
  // "bookings_only"-administrator), ikke en hovedadministrators egen
  // manuelle booking i adminpanelet (som henter ledige tider fra nettopp
  // dette endepunktet, se app/admin/BookingsInsights.tsx). Uten dette
  // unntaket ble admin feilaktig møtt med "stengt denne dagen" på alle
  // datoer forbi grensen, selv når banen i realiteten var åpen.
  const adminSession = await verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  const isFullAdmin = adminSession?.role === "full";

  if (!isFullAdmin && dateStr < todayInClubTimeZone()) {
    return NextResponse.json({ date: dateStr, slots: [], closed: true, note: null });
  }

  // Starter ALLE uavhengige oppslag SAMTIDIG i stedet for i bølger etter
  // hverandre (tidligere: maxDate ble ventet HELT ferdig FØR holds-
  // oppryddingen og åpningstid-oppslaget i det hele tatt startet – tre
  // separate "bølger" med nettverks-ventetid på HVER ENESTE "hent ledige
  // tider"-forespørsel, i stedet for to). Alle tre er helt uavhengige av
  // hverandre; maxDate ventes inn FØRST under (siden den kan gjøre at vi
  // returnerer tidlig), men de to andre har da allerede vært i gang en
  // stund i bakgrunnen uansett – bortkastet for den sjeldne "for langt frem
  // i tid"-dagen, men en reell gevinst for alle andre (de aller fleste)
  // forespørslene.
  const maxDatePromise = isFullAdmin ? Promise.resolve(null) : getEffectiveSingleBookingMaxDate();
  const holdsCleanupPromise = expireStaleHolds().catch((err) => {
    console.error("[availability] kunne ikke rydde opp utløpte holds:", err);
  });
  const hoursPromise = getEffectiveHoursForDate(dateStr);

  if (!isFullAdmin) {
    // VIKTIG: dette er IKKE det samme som at banen er "stengt" denne dagen
    // – den er fysisk åpen akkurat som vanlig, det er bare ikke lov å booke
    // en ENKELTTIME så langt frem i tid (ennå). Får derfor sitt EGET flagg
    // (`tooFarAhead`) i stedet for å late som dagen er stengt, slik at
    // bookingsiden kan vise en korrekt melding (se BookingCalendar.tsx).
    const maxDate = await maxDatePromise;
    if (maxDate !== null && dateStr > maxDate) {
      return NextResponse.json({ date: dateStr, slots: [], closed: false, tooFarAhead: true, note: null });
    }
  }

  const [hours] = await Promise.all([hoursPromise, holdsCleanupPromise]);
  if (hours.closed) {
    return NextResponse.json({ date: dateStr, slots: [], closed: true, note: hours.note });
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

  const bareSlots = slots.map((slot) => ({
    startTime: slot.startTime.toISOString(),
    endTime: slot.endTime.toISOString(),
    label: slot.label,
    available: !takenStartTimes.has(slot.startTime.toISOString()),
  }));

  // canExtendToHour: om en hel time kan starte akkurat her – dvs. at den
  // KRONOLOGISK påfølgende halvtimen (funnet via faktisk starttidspunkt, ikke
  // array-indeks + 1 – rutenettet kan ha hull, f.eks. en lunsjpause) også
  // selv er ledig. Ingen ekstra databaseoppslag nødvendig – begge halvtimenes
  // `available`-flagg er allerede beregnet over.
  const byStartTime = new Map(bareSlots.map((s, i) => [s.startTime, i]));

  const resultSlots = bareSlots.map((slot) => {
    if (!slot.available) {
      return { ...slot, reason: "booked" as const, canExtendToHour: false };
    }
    const nextIndex = byStartTime.get(slot.endTime);
    const canExtendToHour = nextIndex !== undefined && bareSlots[nextIndex].available;
    return { ...slot, canExtendToHour };
  });

  return NextResponse.json({
    date: dateStr,
    closed: false,
    note: hours.note,
    slots: resultSlots,
  });
}
