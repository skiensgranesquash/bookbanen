import { NextRequest, NextResponse } from "next/server";
import { expireStaleHolds } from "@/lib/holds";

export const dynamic = "force-dynamic";

/**
 * GET /api/squash/cron-expire
 *
 * Sikkerhetsnett: frigjør "pending"-holds som har gått ut, i tilfelle ingen
 * har besøkt availability/bookings-endepunktene (som ellers også rydder opp
 * ved hver forespørsel). Kalles av Vercel Cron i produksjon (se
 * vercel.json) – uten betydning lokalt.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization");

  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await expireStaleHolds();
  return NextResponse.json({ ok: true });
}
