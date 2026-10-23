import { NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { expireStaleHolds } from "@/lib/holds";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/bookings
 *
 * Lister alle bookinger (uansett status), til bruk i adminpanelet. Beskyttet
 * av middleware.ts – krever innlogget admin.
 *
 * Sortert etter NÅR BOOKINGEN BLE OPPRETTET (nyeste øverst) – IKKE etter
 * hvilket klokkeslett som ble booket. repo.listGroups() sin egen rekkefølge
 * (etter øktens tidspunkt) er riktig for andre bruk (f.eks. dagens avtaler i
 * BookingsInsights.tsx), så omsorteringen skjer her, kun for dette
 * endepunktet – se app/admin/AdminDashboard.tsx sin "Siste bookinger".
 */
export async function GET() {
  try {
    await expireStaleHolds();
  } catch (err) {
    console.error("[admin/bookings] kunne ikke rydde opp utløpte holds:", err);
  }

  const repo = await getRepository();
  const groups = await repo.listGroups({});
  const sorted = [...groups].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return NextResponse.json({
    bookings: sorted.map((g) => ({
      id: g.id,
      status: g.status,
      kind: g.kind,
      source: g.source,
      customerName: g.customerName,
      customerPhone: g.customerPhone,
      totalAmountOre: g.totalAmountOre,
      note: g.note,
      createdAt: g.createdAt,
      slots: g.slots
        .map((s) => ({ startTime: s.startTime, endTime: s.endTime }))
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    })),
  });
}
