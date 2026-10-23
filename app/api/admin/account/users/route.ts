import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/account/users – liste over admin-brukere (ALDRI passord/hash).
 * POST /api/admin/account/users – opprett en ny admin-bruker fra panelet.
 *
 * Beskyttet av middleware.ts som resten av /api/admin/** – enhver innlogget
 * admin kan se listen og legge til flere (ingen rollehierarki i denne
 * versjonen, bevisst enkelt for en liten klubb).
 */
export async function GET() {
  const repo = await getRepository();
  const users = await repo.listAdminUsers();
  return NextResponse.json({
    users: users
      .map((u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  });
}

interface CreateBody {
  email?: string;
  name?: string;
  password?: string;
}

export async function POST(request: NextRequest) {
  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  const name = body.name?.trim() ?? "";
  const password = body.password ?? "";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Skriv inn en gyldig e-postadresse." }, { status: 400 });
  }
  if (!name || name.length < 2) {
    return NextResponse.json({ error: "Skriv inn navnet til personen." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Passordet bør være minst 8 tegn." }, { status: 400 });
  }

  const repo = await getRepository();
  const existing = await repo.getAdminByEmail(email);
  if (existing) {
    return NextResponse.json({ error: "Det finnes allerede en admin-bruker med denne e-posten." }, { status: 409 });
  }

  const { hash, salt } = await hashPassword(password);
  const user = await repo.createAdminUser({ email, name, passwordHash: hash, passwordSalt: salt });

  return NextResponse.json({
    ok: true,
    user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
  });
}
