import { NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { expireStaleHolds } from "@/lib/holds";
import { MAX_RECURRING_WEEKS } from "@/lib/config";
import { todayInClubTimeZone } from "@/lib/slots";

export const dynamic = "force-dynamic";

/** Hvor mange dager BAKOVER i tid "Siste bookinger" (se app/admin/AdminDashboard.tsx) fortsatt viser historikk for – romslig (et halvt år), men IKKE ubegrenset. Se begrunnelsen i lib/db/supabase.ts sin listGroups. */
const HISTORY_DAYS_BACK = 180;

/** Litt margin FORBI MAX_RECURRING_WEEKS – sikrer at ALLE forekomster i den lengste mulig gjentakende rekken fortsatt kommer med, selv om den akkurat treffer kanten av vinduet. */
const FUTURE_MARGIN_DAYS = 7;

/** Flytter en "YYYY-MM-DD"-dato et gitt antall dager – ren UTC-millisekund-aritmetikk med vilje (ikke date-fns' addDays, som bruker VERTENS lokale tidssone), slik at dette blir riktig uansett hvilken tidssone serveren/maskinen kjører i. Samme mønster som generateWeeklyDates i lib/slots.ts. */
function shiftDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * GET /api/admin/bookings
 *
 * Lister bookinger innenfor et vindu rundt dagens dato (se HISTORY_DAYS_BACK/
 * FUTURE_MARGIN_DAYS over) – IKKE lenger ALT noensinne booket, se
 * begrunnelsen i lib/db/supabase.ts sin listGroups. Beskyttet av
 * middleware.ts – krever innlogget admin.
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
  const today = todayInClubTimeZone();
  const groups = await repo.listGroups({
    fromDate: shiftDateString(today, -HISTORY_DAYS_BACK),
    toDate: shiftDateString(today, MAX_RECURRING_WEEKS * 7 + FUTURE_MARGIN_DAYS),
  });
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
