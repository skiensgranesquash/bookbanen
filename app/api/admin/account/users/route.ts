import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import type { AdminRole } from "@/lib/db/types";

export const dynamic = "force-dynamic";

const VALID_ROLES: AdminRole[] = ["full", "bookings_only"];

/**
 * GET  /api/admin/account/users – liste over admin-brukere (ALDRI passord/hash).
 * POST /api/admin/account/users – opprett en ny admin-bruker fra panelet.
 *
 * Beskyttet av middleware.ts som resten av /api/admin/** – OG middleware.ts
 * blokkerer i tillegg denne ene ruten helt for "bookings_only"-administratorer
 * (se BOOKINGS_ONLY_ALLOWED_API_PATHS der), slik at en begrenset admin aldri
 * kan opprette flere admin-brukere eller se listen over dem, uansett om de
 * prøver via UI-et eller et håndskrevet API-kall. En "full" administrator kan
 * fortsatt opprette både flere fulle OG begrensede administratorer herfra.
 */
export async function GET() {
  const repo = await getRepository();
  const users = await repo.listAdminUsers();
  return NextResponse.json({
    users: users
      .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  });
}

interface CreateBody {
  email?: string;
  name?: string;
  password?: string;
  role?: string;
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
  // Utelatt rolle betyr "full" – samme standardvalg som create-admin.ts, og
  // trygt siden "full" alltid har vært den eneste muligheten før dette feltet
  // fantes.
  const role = (body.role?.trim() || "full") as AdminRole;

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Skriv inn en gyldig e-postadresse." }, { status: 400 });
  }
  if (!name || name.length < 2) {
    return NextResponse.json({ error: "Skriv inn navnet til personen." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Passordet bør være minst 8 tegn." }, { status: 400 });
  }
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "Ugyldig rolle." }, { status: 400 });
  }

  const repo = await getRepository();
  const existing = await repo.getAdminByEmail(email);
  if (existing) {
    return NextResponse.json({ error: "Det finnes allerede en admin-bruker med denne e-posten." }, { status: 409 });
  }

  const { hash, salt } = await hashPassword(password);
  const user = await repo.createAdminUser({ email, name, passwordHash: hash, passwordSalt: salt, role });

  return NextResponse.json({
    ok: true,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt },
  });
}
