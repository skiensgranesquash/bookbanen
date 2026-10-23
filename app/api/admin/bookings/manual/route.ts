import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { isValidBookingDateString, isWithinOpeningHours, occurrenceRange } from "@/lib/slots";
import { normalizeNorwegianMobile } from "@/lib/phone";
import { BOOKING_DURATION_SLOTS, PRICE_PER_SLOT_ORE } from "@/lib/config";
import { effectiveHoursForDate, getHoursContext } from "@/lib/settings/openingHours";

export const dynamic = "force-dynamic";

interface ManualBookingBody {
  date?: string;
  time?: string;
  name?: string;
  phone?: string;
}

/**
 * POST /api/admin/bookings/manual
 * Body: { date: "YYYY-MM-DD", time: "HH:mm", name: string, phone?: string }
 *
 * Admin booker en time direkte på vegne av en kunde (f.eks. betalt kontant,
 * eller bare registrert manuelt) – ingen betaling involvert, bindende med en
 * gang. Varigheten er alltid nøyaktig 1 time, akkurat som en vanlig booking
 * – samme rutenett og åpningstider gjelder, se app/api/squash/bookings/route.ts.
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

  const range = occurrenceRange(date, time, BOOKING_DURATION_SLOTS);
  if (!range) {
    return NextResponse.json({ error: "Ugyldig klokkeslett." }, { status: 400 });
  }

  const hoursContext = await getHoursContext();
  if (!isWithinOpeningHours(range.startTime, range.endTime, effectiveHoursForDate(date, hoursContext))) {
    return NextResponse.json(
      { error: "Denne dagen er stengt, eller klokkeslettet passer ikke innenfor åpningstidene." },
      { status: 400 }
    );
  }

  const repo = await getRepository();
  const result = await repo.createAdminBooking({
    customerName: name,
    customerPhone: phone,
    totalAmountOre: PRICE_PER_SLOT_ORE * BOOKING_DURATION_SLOTS,
    range: { startTime: range.startTime.toISOString(), endTime: range.endTime.toISOString() },
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: "Den tiden er allerede opptatt. Velg et annet klokkeslett.", conflicts: result.conflicts },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true, id: result.group.id });
}
