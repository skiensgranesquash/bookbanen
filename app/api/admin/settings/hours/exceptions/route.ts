import { NextRequest, NextResponse } from "next/server";
import { removeExceptionsForDates, upsertExceptionsForDates, type TimeInterval } from "@/lib/settings/openingHours";

export const dynamic = "force-dynamic";

/**
 * POST   /api/admin/settings/hours/exceptions – "masseendre": setter (eller
 *        overskriver) samme unntak (stengt, eller egne klokkeslett + notat)
 *        for ALLE datoene i `dates` på én gang. Dette er ruten adminsiden
 *        bruker når man har markert flere dager i ferie-kalenderen.
 * DELETE /api/admin/settings/hours/exceptions – fjerner unntak for de gitte
 *        datoene igjen (tilbake til ukedagens standard åpningstid).
 *
 * Beskyttet av middleware.ts – krever gyldig admin-sesjon.
 */
interface UpsertBody {
  dates?: string[];
  closed?: boolean;
  intervals?: Partial<TimeInterval>[];
  note?: string;
}

export async function POST(request: NextRequest) {
  let body: UpsertBody;
  try {
    body = (await request.json()) as UpsertBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  if (!Array.isArray(body.dates) || body.dates.length === 0) {
    return NextResponse.json({ error: "Velg minst én dato." }, { status: 400 });
  }

  try {
    const exceptions = await upsertExceptionsForDates(body.dates, {
      closed: !!body.closed,
      intervals: body.intervals,
      note: body.note,
    });
    return NextResponse.json({ ok: true, exceptions });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Kunne ikke lagre." }, { status: 400 });
  }
}

interface DeleteBody {
  dates?: string[];
}

export async function DELETE(request: NextRequest) {
  let body: DeleteBody;
  try {
    body = (await request.json()) as DeleteBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  if (!Array.isArray(body.dates) || body.dates.length === 0) {
    return NextResponse.json({ error: "Velg minst én dato." }, { status: 400 });
  }

  try {
    const exceptions = await removeExceptionsForDates(body.dates);
    return NextResponse.json({ ok: true, exceptions });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Kunne ikke fjerne." }, { status: 400 });
  }
}
