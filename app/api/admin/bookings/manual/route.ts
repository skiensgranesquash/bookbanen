import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { generateWeeklyDates, isValidBookingDateString, isWithinOpeningHours, occurrenceRange } from "@/lib/slots";
import { normalizeNorwegianMobile } from "@/lib/phone";
import {
  COURT_ID,
  durationMinutesToSlots,
  isBookableDurationMinutes,
  MAX_RECURRING_WEEKS,
  VENUE_NAME,
  type BookingDurationMinutes,
} from "@/lib/config";
import { formatDurationMinutes } from "@/lib/formatting";
import { getPaymentProviderImpl } from "@/lib/payments";
import { effectiveHoursForDate, getHoursContext } from "@/lib/settings/openingHours";
import { getAdminPaymentRequestHoldMinutes } from "@/lib/settings/adminPaymentHold";
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
  /**
   * true = ikke book bindende med en gang – send i stedet en Vipps-
   * betalingsforespørsel ("PUSH_MESSAGE") til telefonnummeret, og bookingen
   * blir først bindende når kunden har godkjent/betalt (se egen gren
   * nederst). Krever at "phone" er et gyldig norsk mobilnummer – ellers er
   * telefon valgfritt for admin.
   */
  requestPayment?: boolean;
}

/**
 * POST /api/admin/bookings/manual
 * Body: { date, time, name, phone?, durationMinutes?, weeks?, requestPayment? }
 *
 * To modi:
 * - requestPayment utelatt/false (standard): admin booker bindende med en
 *   gang, ingen betaling involvert – som før.
 * - requestPayment: true: oppretter i stedet en "pending" booking (akkurat
 *   som den offentlige bookingsiden) og sender en ekte Vipps-betalings-
 *   forespørsel ("PUSH_MESSAGE", se lib/payments/vipps.ts) rett til kundens
 *   telefon – ingen nettleser-omdirigering involvert, siden det er ADMIN,
 *   ikke kunden selv, som sitter i denne nettleseren akkurat nå. Bookingen
 *   blir først bindende (status "confirmed") når kunden godkjenner i
 *   Vipps-appen – helt samme webhook/avstemmingslogikk som kundens egen
 *   bookingsflyt (se app/api/squash/vipps-webhook/route.ts), siden alt her
 *   er identifisert med samme slags gruppe-id som referanse.
 *
 * Varigheten er 30 minutter eller 1 time (se BOOKABLE_DURATIONS_MINUTES i
 * lib/config.ts) – 1 time er fortsatt forhåndsvalgt som standard.
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
  const requestPayment = body.requestPayment === true;

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

  // Telefon er valgfritt for admin NÅR bookingen gjøres bindende med en
  // gang (i motsetning til den offentlige bookingsiden) – men hvis noe er
  // skrevet inn, må det se ut som et ekte norsk mobilnummer, slik at det
  // stemmer overens med leaderboard/statistikk. Sender admin i stedet en
  // betalingsforespørsel, er telefon PÅKREVD (se sjekken under) – det er jo
  // dit forespørselen sendes.
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

  if (requestPayment && !phone) {
    return NextResponse.json(
      { error: "Mobilnummer er påkrevd for å sende en betalingsforespørsel." },
      { status: 400 }
    );
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
  const totalAmountOre = priceForDuration(pricing, durationMinutes) * validOccurrences.length;
  const repo = await getRepository();

  if (!requestPayment) {
    const result = await repo.createAdminBooking({
      customerName: name,
      customerPhone: phone,
      totalAmountOre,
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

  // --- requestPayment: true – samme to-trinns mønster som den offentlige
  // bookingsiden (pending-gruppe + hold, deretter start betaling), men med
  // userFlow "PUSH_MESSAGE" (se lib/payments/vipps.ts) i stedet for
  // "WEB_REDIRECT", siden det er ADMIN som sitter i denne nettleseren, ikke
  // kunden – se app/api/squash/bookings/route.ts for det nesten identiske
  // kunde-mønsteret dette er bygget etter.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    console.error("[admin/bookings/manual] NEXT_PUBLIC_SITE_URL mangler.");
    return NextResponse.json({ error: "Serverkonfigurasjonsfeil." }, { status: 500 });
  }

  const bookingId = randomUUID();
  const holdMinutes = await getAdminPaymentRequestHoldMinutes();
  const holdExpiresAt = new Date(Date.now() + holdMinutes * 60_000);

  const createResult = await repo.createGroupWithSlots({
    id: bookingId,
    kind: weeks > 1 ? "recurring" : "single",
    source: "admin",
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
          weeks > 1
            ? "Én eller flere av datoene i rekken er allerede opptatt. Juster tidspunkt eller antall uker."
            : "Den tiden er allerede opptatt. Velg et annet klokkeslett.",
        conflicts: createResult.conflicts,
      },
      { status: 409 }
    );
  }

  const description =
    weeks > 1
      ? `Squash ${time} hver uke i ${validOccurrences.length} uker fra ${date} (${formatDurationMinutes(durationMinutes)}) – ${VENUE_NAME}`
      : `Squash ${time}, ${date} (${formatDurationMinutes(durationMinutes)}) – ${VENUE_NAME}`;

  try {
    const provider = await getPaymentProviderImpl();
    const payment = await provider.createPayment({
      reference: bookingId,
      amountOre: totalAmountOre,
      phoneNumber: phone,
      description,
      returnUrl: `${siteUrl}/confirmation?ref=${bookingId}`,
      userFlow: "PUSH_MESSAGE",
    });

    return NextResponse.json({
      ok: true,
      id: bookingId,
      pending: true,
      redirectUrl: payment.redirectUrl,
    });
  } catch (err) {
    // Klarte ikke å sende betalingsforespørselen – rull tilbake holdet med
    // en gang, slik at tiden(e) blir ledig(e) igjen.
    await repo.cancelGroupAsAdmin(bookingId);
    console.error("[admin/bookings/manual] feil ved oppstart av betalingsforespørsel:", err);
    return NextResponse.json(
      { error: "Kunne ikke sende betalingsforespørsel akkurat nå. Prøv igjen." },
      { status: 502 }
    );
  }
}
