import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { generateWeeklyDates, isValidBookingDateString, isWithinOpeningHours, occurrenceRange } from "@/lib/slots";
import { normalizeNorwegianMobile } from "@/lib/phone";
import {
  durationMinutesToSlots,
  isBookableDurationMinutes,
  MAX_RECURRING_WEEKS,
  type BookingDurationMinutes,
} from "@/lib/config";
import { effectiveHoursForDate, getHoursContext } from "@/lib/settings/openingHours";
import { getPricingSettings, priceForDuration } from "@/lib/settings/pricing";

export const dynamic = "force-dynamic";

interface ManualBookingBody {
  date?: string;
  time?: string;
  name?: string;
  phone?: string;
  /** 30 eller 60 (minutter) – utelatt betyr 60, den gamle, faste varigheten. */
  durationMinutes?: number;
  /** Antall uker i en gjentakende rekke (samme ukedag/klokkeslett hver uke – "date" er FØRSTE forekomst). Utelatt eller 1 betyr en vanlig enkeltbooking. */
  weeks?: number;
}

/**
 * POST /api/admin/bookings/manual
 * Body: { date: "YYYY-MM-DD", time: "HH:mm", name: string, phone?: string, durationMinutes?: 30 | 60, weeks?: number }
 *
 * Admin booker en eller flere tider direkte på vegne av en kunde (f.eks.
 * betalt kontant, eller bare registrert manuelt) – ingen betaling involvert,
 * bindende med en gang. Varigheten er 30 minutter eller 1 time, samme valg
 * som en vanlig booking har (se BOOKABLE_DURATIONS_MINUTES i lib/config.ts)
 * – 1 time er fortsatt forhåndsvalgt som standard, siden det var den gamle,
 * faste oppførselen.
 *
 * "weeks" > 1 gjør bookingen gjentakende – samme ukedag/klokkeslett hver uke
 * fra og med "date", akkurat som den offentlige bookingsiden (se
 * app/api/squash/bookings/route.ts), men UTEN kundens egen
 * recurringCutoffDate/maxWeeks-grense (se lib/settings/recurringLimit.ts) –
 * den grensen er en selvbetjenings-brems for kunder, ikke noe admin selv
 * skal være begrenset av. Fortsatt begrenset av det globale
 * MAX_RECURRING_WEEKS-taket under, som en siste sikkerhetsgrense.
 */
export async function POST(request: NextRequest) {
  let body: ManualBookingBody;
  try {
    body = (await request.json()) as ManualBookingBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  const { date, time } = body;
  const name = body.name?.trim() ?? "";
  const rawPhone = body.phone?.trim() ?? "";

  if (!date || !isValidBookingDateString(date)) {
    return NextResponse.json({ error: "Ugyldig dato." }, { status: 400 });
  }
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return NextResponse.json({ error: "Ugyldig klokkeslett." }, { status: 400 });
  }

  const weeks = Number(body.weeks ?? 1);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_RECURRING_WEEKS) {
    return NextResponse.json({ error: `Antall uker må være mellom 1 og ${MAX_RECURRING_WEEKS}.` }, { status: 400 });
  }

  const durationMinutes: BookingDurationMinutes = isBookableDurationMinutes(body.durationMinutes)
    ? body.durationMinutes
    : 60;

  if (name.length < 2 || name.length > 100) {
    return NextResponse.json({ error: "Navn må være mellom 2 og 100 tegn." }, { status: 400 });
  }

  // Telefon er valgfritt for admin (i motsetning til den offentlige
  // bookingsiden) – men hvis noe er skrevet inn, må det se ut som et ekte
  // norsk mobilnummer, slik at det stemmer overens med leaderboard/statistikk.
  let phone = "";
  if (rawPhone) {
    const normalized = normalizeNorwegianMobile(rawPhone);
    if (!normalized) {
      return NextResponse.json(
        { error: "Ugyldig mobilnummer. La feltet stå tomt, eller bruk et norsk mobilnummer." },
        { status: 400 }
      );
    }
    phone = normalized;
  }

  const dates = generateWeeklyDates(date, weeks);
  const durationSlots = durationMinutesToSlots(durationMinutes);
  const occurrences = dates.map((d) => occurrenceRange(d, time, durationSlots));
  if (occurrences.some((o) => !o)) {
    return NextResponse.json({ error: "Klokkeslettet finnes ikke i timeplanen." }, { status: 400 });
  }
  const validOccurrences = occurrences as Array<{ startTime: Date; endTime: Date }>;

  // Hver dato i rekken kan ha sine EGNE åpningstider (ukedagens standard,
  // eller en "ferie/annerledesdag"-unntak) – slå opp alt i étt oppslag og
  // sjekk hver forekomst mot sin egen dags effektive åpningstid, i stedet
  // for én global åpningstid for alle datoene. Samme mønster som
  // app/api/squash/bookings/route.ts.
  const hoursContext = await getHoursContext();
  const outOfHoursIndex = validOccurrences.findIndex(
    (o, i) => !isWithinOpeningHours(o.startTime, o.endTime, effectiveHoursForDate(dates[i], hoursContext))
  );
  if (outOfHoursIndex !== -1) {
    return NextResponse.json(
      {
        error:
          weeks > 1
            ? `${dates[outOfHoursIndex]} er stengt eller har andre åpningstider – juster klokkeslett eller antall uker.`
            : "Denne dagen er stengt, eller klokkeslettet passer ikke innenfor åpningstidene.",
      },
      { status: 400 }
    );
  }

  const pricing = await getPricingSettings();
  const repo = await getRepository();
  const result = await repo.createAdminBooking({
    customerName: name,
    customerPhone: phone,
    totalAmountOre: priceForDuration(pricing, durationMinutes) * validOccurrences.length,
    ranges: validOccurrences.map((o) => ({ startTime: o.startTime.toISOString(), endTime: o.endTime.toISOString() })),
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error:
          weeks > 1
            ? "Én eller flere av datoene i rekken er allerede opptatt. Juster tidspunkt eller antall uker."
            : "Den tiden er allerede opptatt. Velg et annet klokkeslett.",
        conflicts: result.conflicts,
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true, id: result.group.id });
}
