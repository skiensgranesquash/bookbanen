import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { getPaymentProviderImpl } from "@/lib/payments";
import { isValidBookingDateString, isWithinOpeningHours, occurrenceRange } from "@/lib/slots";
import { normalizeNorwegianMobile } from "@/lib/phone";
import { SLOT_LENGTH_MINUTES } from "@/lib/config";
import { effectiveHoursForDate, getHoursContext } from "@/lib/settings/openingHours";

export const dynamic = "force-dynamic";

interface PatchBody {
  name?: string;
  phone?: string;
  date?: string;
  time?: string;
  /** Satt av "Rediger"-modalen når bookingen som redigeres er avlyst – se app/admin/BookingsInsights.tsx. */
  reactivate?: boolean;
}

/**
 * PATCH /api/admin/bookings/:id
 * Body: { name?, phone?, date?, time?, reactivate? }
 *
 * Admin redigerer navn/telefon og/eller flytter klokkeslettet på en
 * eksisterende booking (brukt fra "Rediger" i dagens avtaleoversikt i
 * adminpanelet). Klokkeslett kan kun flyttes for kind "single" – en
 * gjentakende rekke har flere tidsrom i samme gruppe, og en blokkering er
 * ikke en kundebooking i det hele tatt.
 *
 * `reactivate: true` betyr at bookingen som redigeres er AVLYST, og at admin
 * ønsker å aktivere den på nytt (status "cancelled" -> "confirmed") – samme
 * modal, bare at lagre-knappen da også gjenåpner bookingen i stedet for å
 * bare oppdatere detaljer. Konflikt sjekkes uansett på nytt (se
 * reactivateGroupAsAdmin), siden noen andre kan ha booket akkurat denne
 * tiden i mellomtiden mens den lå avlyst.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  const repo = await getRepository();
  const existing = await repo.getGroupByReference(id);
  if (!existing) {
    return NextResponse.json({ error: "Fant ingen booking med denne referansen." }, { status: 404 });
  }

  if (body.reactivate) {
    if (existing.kind === "block") {
      return NextResponse.json({ error: "Blokkeringer kan ikke aktiveres på nytt her." }, { status: 400 });
    }
    if (existing.status !== "cancelled") {
      return NextResponse.json({ error: "Bare avlyste bookinger kan aktiveres på nytt." }, { status: 400 });
    }
  }

  const patch: { customerName?: string; customerPhone?: string; range?: { startTime: string; endTime: string } } = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (name.length < 2 || name.length > 100) {
      return NextResponse.json({ error: "Navn må være mellom 2 og 100 tegn." }, { status: 400 });
    }
    patch.customerName = name;
  }

  if (body.phone !== undefined) {
    const rawPhone = body.phone.trim();
    if (rawPhone) {
      const normalized = normalizeNorwegianMobile(rawPhone);
      if (!normalized) {
        return NextResponse.json(
          { error: "Ugyldig mobilnummer. La feltet stå tomt, eller bruk et norsk mobilnummer." },
          { status: 400 }
        );
      }
      patch.customerPhone = normalized;
    } else {
      patch.customerPhone = "";
    }
  }

  if (body.date !== undefined || body.time !== undefined) {
    if (existing.kind !== "single") {
      return NextResponse.json(
        { error: "Klokkeslett kan kun endres for enkeltbookinger, ikke gjentakende eller blokkerte tider." },
        { status: 400 }
      );
    }

    const { date, time } = body;
    if (!date || !isValidBookingDateString(date)) {
      return NextResponse.json({ error: "Ugyldig dato." }, { status: 400 });
    }
    if (!time || !/^\d{2}:\d{2}$/.test(time)) {
      return NextResponse.json({ error: "Ugyldig klokkeslett." }, { status: 400 });
    }

    // Bookingen kan opprinnelig ha vært enten 30 minutter eller 1 time (se
    // BOOKABLE_DURATIONS_MINUTES i lib/config.ts) – når admin flytter
    // klokkeslettet skal den EGNE, eksisterende varigheten beholdes (ikke
    // tvinges til 1 time), så den utledes her fra bookingens egen,
    // nåværende slot i stedet for en fast konstant.
    const existingSlot = existing.slots[0];
    const existingDurationMinutes = existingSlot
      ? Math.round((new Date(existingSlot.endTime).getTime() - new Date(existingSlot.startTime).getTime()) / 60_000)
      : 60;
    const durationSlots = Math.max(1, Math.round(existingDurationMinutes / SLOT_LENGTH_MINUTES));

    const range = occurrenceRange(date, time, durationSlots);
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

    patch.range = { startTime: range.startTime.toISOString(), endTime: range.endTime.toISOString() };
  }

  const result = body.reactivate
    ? await repo.reactivateGroupAsAdmin(id, patch)
    : await repo.updateBookingDetails(id, patch);

  if (!result.ok) {
    return NextResponse.json(
      {
        error: body.reactivate
          ? "Tiden er dessverre booket av noen andre i mellomtiden. Velg et annet tidspunkt."
          : "Det nye tidspunktet er allerede opptatt. Velg et annet klokkeslett.",
        conflicts: result.conflicts,
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/bookings/:id
 *
 * Avlyser en booking uansett status. Var den "confirmed" (dvs. faktisk
 * betalt), forsøker vi å refundere via betalingsleverandøren – i mock-modus
 * er dette bare en logglinje, i ekte Vipps-modus en faktisk refusjon.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const repo = await getRepository();
  const previous = await repo.cancelGroupAsAdmin(id);

  if (!previous) {
    return NextResponse.json({ error: "Fant ingen booking med denne referansen." }, { status: 404 });
  }

  if (previous.status === "confirmed" && previous.kind !== "block") {
    try {
      const provider = await getPaymentProviderImpl();
      await provider.refund(previous.paymentReference, previous.totalAmountOre);
    } catch (err) {
      console.error("[admin/bookings] refusjon feilet (bookingen er likevel avlyst):", err);
      return NextResponse.json(
        {
          ok: true,
          warning: "Bookingen ble avlyst, men refusjonen feilet – husk å refundere manuelt i Vipps-portalen.",
        },
        { status: 200 }
      );
    }
  }

  return NextResponse.json({ ok: true });
}
