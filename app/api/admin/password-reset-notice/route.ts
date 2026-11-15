import { NextResponse } from "next/server";
import { getPasswordResetNotice, clearPasswordResetNotice } from "@/lib/settings/passwordResetNotice";

export const dynamic = "force-dynamic";

/**
 * GET    /api/admin/password-reset-notice – hent dagens "noen har glemt
 *        passordet sitt"-varsel (eller null hvis ingen venter), vist øverst
 *        på alle admin-sider av AdminNav.tsx.
 * DELETE /api/admin/password-reset-notice – fjern varselet. Hvem som helst
 *        innlogget kan fjerne det – det er en delt beskjed, ikke noe
 *        personlig per administrator.
 *
 * Tilgjengelig for BÅDE "full" og "bookings_only"-administratorer (se
 * BOOKINGS_ONLY_ALLOWED_API_EXACT i middleware.ts) – en begrenset
 * administrator bør også få vite at en kollega har glemt passordet sitt.
 */
export async function GET() {
  const notice = await getPasswordResetNotice();
  return NextResponse.json({ notice });
}

export async function DELETE() {
  await clearPasswordResetNotice();
  return NextResponse.json({ ok: true });
}
