import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { normalizeNorwegianMobile } from "@/lib/phone";

export const dynamic = "force-dynamic";

/**
 * GET /api/squash/customer-lookup?phone=91234567
 *
 * Slår opp navnet knyttet til forrige booking med samme mobilnummer, slik at
 * bookingskjemaet kan fylle ut navnet automatisk selv om kunden booker fra
 * en helt ny nettleser/enhet (se telefon-effekten i app/BookingCalendar.tsx
 * – navn/telefon huskes ELLERS kun lokalt per nettleser via localStorage).
 *
 * Returnerer alltid 200 med { name: null } hvis nummeret er ugyldig eller
 * ikke finnes fra før – dette er en ren bekvemmelighetsfunksjon for å fylle
 * ut et felt, ingen feilmelding skal noensinne vises til brukeren basert på
 * svaret herfra.
 */
export async function GET(request: NextRequest) {
  const phoneParam = request.nextUrl.searchParams.get("phone") ?? "";
  const phone = normalizeNorwegianMobile(phoneParam);
  if (!phone) {
    return NextResponse.json({ name: null });
  }

  try {
    const repo = await getRepository();
    const name = await repo.findCustomerNameByPhone(phone);
    return NextResponse.json({ name });
  } catch (err) {
    console.error("[customer-lookup] oppslag feilet:", err);
    return NextResponse.json({ name: null });
  }
}
