import { NextRequest, NextResponse } from "next/server";
import { reconcileBooking } from "@/lib/reconcile";

export const dynamic = "force-dynamic";

// NB: Next.js 15 gjorde `params` asynkron (en Promise). Koden under virker
// fint også på Next 13/14, siden `await` på en vanlig (ikke-Promise) verdi
// bare returnerer verdien uendret.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ reference: string }> }
) {
  try {
    const { reference } = await params;
    const group = await reconcileBooking(reference);

    if (!group) {
      return NextResponse.json({ error: "Fant ingen booking med denne referansen." }, { status: 404 });
    }

    // Bevisst KUN status, type og tidsrom – ikke navn/telefon – siden denne
    // referansen i prinsippet kan havne i en nettleserhistorikk.
    return NextResponse.json({
      status: group.status,
      kind: group.kind,
      totalAmountOre: group.totalAmountOre,
      slots: group.slots
        .map((s) => ({ startTime: s.startTime, endTime: s.endTime }))
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    });
  } catch (err) {
    console.error("[bookings/:reference] feil ved statussjekk:", err);
    return NextResponse.json({ error: "Kunne ikke hente status akkurat nå." }, { status: 500 });
  }
}
