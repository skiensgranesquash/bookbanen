import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { expireStaleHolds } from "@/lib/holds";
import {
  generateWeeklyDates,
  isDateBookable,
  isValidBookingDateString,
  isWithinOpeningHours,
  occurrenceRange,
  todayInClubTimeZone,
} from "@/lib/slots";
import { normalizeNorwegianMobile } from "@/lib/phone";
import {
  BOOKING_DURATION_MINUTES,
  BOOKING_DURATION_SLOTS,
  COURT_ID,
  HOLD_MINUTES,
  MAX_RECURRING_WEEKS,
  PRICE_PER_SLOT_ORE,
  VENUE_NAME,
} from "@/lib/config";
import { formatDurationMinutes } from "@/lib/formatting";
import { getPaymentProviderImpl } from "@/lib/payments";
import { effectiveHoursForDate, getHoursContext } from "@/lib/settings/openingHours";

export const dynamic = "force-dynamic";

interface CreateBookingBody {
  mode?: "single" | "recurring";
  date?: string;
  time?: string;
  weeks?: number;
  name?: string;
  phone?: string;
}

/**
 * POST /api/squash/bookings
 *
 * Enkeltøkt: { mode: "single", date, time, name, phone }
 * Gjentakende: { mode: "recurring", date, time, weeks, name, phone }
 *   – "date" er FØRSTE forekomst; samme ukedag/klokkeslett gjentas `weeks`
 *   ganger totalt (inkludert den første).
 *
 * Varigheten er ALLTID nøyaktig BOOKING_DURATION_SLOTS (1 time) – den tas
 * bevisst ALDRI imot fra klienten (ingen `durationSlots`-felt i body lenger),
 * slik at det ikke finnes noen vei – verken en gyldig klient-UI eller et
 * håndskrevet API-kall – til å booke en annen varighet enn 1 time.
 *
 * Oppretter et midlertidig "hold" på alle tidsrommene og starter én samlet
 * betaling for hele bookingen. Ingenting blir bindende før betalingen er
 * gjennomført – se lib/reconcile.ts.
 */
export async function POST(request: NextRequest) {
  let body: CreateBookingBody;
  try {
    body = (await request.json()) as CreateBookingBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  const mode = body.mode === "recurring" ? "recurring" : "single";
  const { date, time } = body;
  const durationSlots = BOOKING_DURATION_SLOTS;
  const weeks = Number(body.weeks ?? 1);
  const name = body.name?.trim() ?? "";
  const phone = normalizeNorwegianMobile(body.phone ?? "");

  if (!date || !isValidBookingDateString(date)) {
    return NextResponse.json({ error: "Ugyldig dato." }, { status: 400 });
  }
  if (mode === "single" && !isDateBookable(date)) {
    return NextResponse.json({ error: "Datoen er ikke bookbar." }, { status: 400 });
  }
  if (mode === "recurring" && date < todayInClubTimeZone()) {
    return NextResponse.json({ error: "Startdatoen kan ikke være i fortiden." }, { status: 400 });
  }
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return NextResponse.json({ error: "Ugyldig klokkeslett." }, { status: 400 });
  }
  if (mode === "recurring" && (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_RECURRING_WEEKS)) {
    return NextResponse.json({ error: `Antall uker må være mellom 1 og ${MAX_RECURRING_WEEKS}.` }, { status: 400 });
  }
  if (name.length < 2 || name.length > 100) {
    return NextResponse.json({ error: "Navn må være mellom 2 og 100 tegn." }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json(
      { error: "Ugyldig mobilnummer. Bruk et norsk mobilnummer, f.eks. 91234567." },
      { status: 400 }
    );
  }

  const dates = mode === "recurring" ? generateWeeklyDates(date, weeks) : [date];
  const occurrences = dates.map((d) => occurrenceRange(d, time, durationSlots));

  if (occurrences.some((o) => !o)) {
    return NextResponse.json({ error: "Klokkeslettet finnes ikke i timeplanen." }, { status: 400 });
  }
  const validOccurrences = occurrences as Array<{ startTime: Date; endTime: Date }>;

  // Hver dato i rekken kan ha sine EGNE åpningstider (ukedagens standard,
  // eller en "ferie/annerledesdag"-unntak) – slå opp alt i ett oppslag og
  // sjekk hver forekomst mot sin egen dags effektive åpningstid, i stedet
  // for én global åpningstid for alle datoene.
  const hoursContext = await getHoursContext();
  const outOfHoursIndex = validOccurrences.findIndex(
    (o, i) => !isWithinOpeningHours(o.startTime, o.endTime, effectiveHoursForDate(dates[i], hoursContext))
  );
  if (outOfHoursIndex !== -1) {
    return NextResponse.json(
      {
        error:
          mode === "recurring"
            ? `${dates[outOfHoursIndex]} er stengt eller har andre åpningstider – juster klokkeslett eller antall uker.`
            : "Denne dagen er stengt, eller klokkeslettet passer ikke innenfor åpningstidene.",
      },
      { status: 400 }
    );
  }
  if (validOccurrences[0].startTime.getTime() <= Date.now()) {
    return NextResponse.json({ error: "Denne tiden har allerede passert." }, { status: 400 });
  }

  try {
    await expireStaleHolds();
  } catch (err) {
    console.error("[bookings] kunne ikke rydde opp utløpte holds før booking:", err);
  }

  const bookingId = randomUUID();
  const holdExpiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000);
  const totalAmountOre = PRICE_PER_SLOT_ORE * durationSlots * validOccurrences.length;

  const repo = await getRepository();
  const createResult = await repo.createGroupWithSlots({
    id: bookingId,
    kind: mode,
    customerName: name,
    customerPhone: phone,
    totalAmountOre,
    holdExpiresAt: holdExpiresAt.toISOString(),
    slots: validOccurrences.map((o) => ({
      courtId: COURT_ID,
      startTime: o.startTime.toISOString(),
      endTime: o.endTime.toISOString(),
    })),
  });

  if (!createResult.ok) {
    return NextResponse.json(
      {
        error:
          mode === "recurring"
            ? "Én eller flere av datoene i rekken er allerede opptatt. Juster tidspunkt eller antall uker."
            : "Beklager, den tiden ble akkurat tatt av noen andre. Velg en annen tid.",
        conflicts: createResult.conflicts,
      },
      { status: 409 }
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    console.error("[bookings] NEXT_PUBLIC_SITE_URL mangler.");
    await repo.cancelGroupAsAdmin(bookingId);
    return NextResponse.json({ error: "Serverkonfigurasjonsfeil." }, { status: 500 });
  }

  const description =
    mode === "recurring"
      ? `Squash ${time} hver uke i ${validOccurrences.length} uker fra ${date} – ${VENUE_NAME}`
      : `Squash ${time}, ${date} (${formatDurationMinutes(BOOKING_DURATION_MINUTES)}) – ${VENUE_NAME}`;

  try {
    const provider = await getPaymentProviderImpl();
    const payment = await provider.createPayment({
      reference: bookingId,
      amountOre: totalAmountOre,
      phoneNumber: phone,
      description,
      returnUrl: `${siteUrl}/confirmation?ref=${bookingId}`,
    });

    return NextResponse.json({
      reference: bookingId,
      redirectUrl: payment.redirectUrl,
      holdExpiresAt: holdExpiresAt.toISOString(),
    });
  } catch (err) {
    // Klarte ikke å starte betalingen – rull tilbake holdet med en gang, slik
    // at tidene blir ledige igjen for andre.
    await repo.cancelGroupAsAdmin(bookingId);
    console.error("[bookings] feil ved oppstart av betaling:", err);
    return NextResponse.json(
      { error: "Kunne ikke starte betaling akkurat nå. Prøv igjen." },
      { status: 502 }
    );
  }
}
