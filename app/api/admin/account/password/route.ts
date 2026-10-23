import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE_NAME, verifySessionCookieValue } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

interface Body {
  currentPassword?: string;
  newPassword?: string;
}

/**
 * POST /api/admin/account/password
 *
 * Lar en innlogget admin bytte sitt EGET passord. Krever nåværende passord
 * (ikke bare gyldig sesjon) – forhindrer at en glemt, ulåst nettleserfane gir
 * noen andre mulighet til å overta kontoen ved å sette et nytt passord.
 */
export async function POST(request: NextRequest) {
  const session = await verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Ikke innlogget." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  const currentPassword = body.currentPassword ?? "";
  const newPassword = body.newPassword ?? "";

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Fyll ut begge feltene." }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: "Det nye passordet bør være minst 8 tegn." }, { status: 400 });
  }

  const repo = await getRepository();
  const user = await repo.getAdminByEmail(session.email);
  if (!user) {
    return NextResponse.json({ error: "Fant ikke brukeren din." }, { status: 404 });
  }

  const currentOk = await verifyPassword(currentPassword, user.passwordHash, user.passwordSalt);
  if (!currentOk) {
    return NextResponse.json({ error: "Feil nåværende passord." }, { status: 401 });
  }

  const { hash, salt } = await hashPassword(newPassword);
  await repo.updateAdminPassword(user.id, hash, salt);

  return NextResponse.json({ ok: true });
}
