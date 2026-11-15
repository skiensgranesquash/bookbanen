import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { SESSION_COOKIE_NAME, verifySessionCookieValue } from "@/lib/auth/session";
import type { AdminRole } from "@/lib/db/types";

export const dynamic = "force-dynamic";

const VALID_ROLES: AdminRole[] = ["full", "bookings_only"];

interface PatchBody {
  name?: string;
  email?: string;
  role?: string;
  /** Valgfritt – satt administrator kan sette et nytt passord DIREKTE for en
   * ANNEN bruker her (uten å kjenne det gamle). Bytte av EGET passord skjer
   * fortsatt via /api/admin/account/password (krever nåværende passord). */
  password?: string;
}

/**
 * PATCH  /api/admin/account/users/:id – endre navn/e-post/rolle, og evt.
 *        sett et nytt passord direkte på en ANNEN admin-bruker.
 * DELETE /api/admin/account/users/:id – slett admin-brukeren.
 *
 * Beskyttet av middleware.ts på samme måte som /api/admin/account/users
 * (GET/POST) – IKKE i noen av BOOKINGS_ONLY_ALLOWED_*-listene der, så en
 * begrenset administrator nektes automatisk, uten at middleware.ts trenger
 * noen endring for denne nye undersiden.
 *
 * To sikkerhetsnett som gjelder BÅDE endring av rolle og sletting:
 *  1) Man kan ikke endre sin EGEN rolle eller slette sin EGEN bruker herfra
 *     (be en annen full administrator om det) – forhindrer at man ved et
 *     uhell låser seg selv ute, eller sletter kontoen man er innlogget med.
 *  2) Det må alltid finnes minst én "full" administrator igjen etterpå –
 *     forhindrer at alle admin-brukere ender opp begrenset (eller slettet),
 *     uten noen som kan rette det opp igjen.
 *
 * NB: rollen ligger signert i selve sesjonscookien (se lib/auth/session.ts)
 * og sjekkes IKKE på nytt mot databasen for hver forespørsel (se
 * middleware.ts) – endres en INNLOGGET admin sin rolle her, beholder
 * personen sin gamle rolle til cookien fornyes (neste innlogging, senest om
 * 7 dager).
 */
async function requireSession(request: NextRequest) {
  return verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({ error: "Ikke innlogget." }, { status: 401 });

  const { id } = await params;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  const repo = await getRepository();
  const users = await repo.listAdminUsers();
  const target = users.find((u) => u.id === id);
  if (!target) {
    return NextResponse.json({ error: "Fant ingen admin-bruker med denne iden." }, { status: 404 });
  }

  const patch: { name?: string; email?: string; role?: AdminRole } = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name || name.length < 2) {
      return NextResponse.json({ error: "Skriv inn navnet til personen." }, { status: 400 });
    }
    patch.name = name;
  }

  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Skriv inn en gyldig e-postadresse." }, { status: 400 });
    }
    const existing = await repo.getAdminByEmail(email);
    if (existing && existing.id !== id) {
      return NextResponse.json(
        { error: "Det finnes allerede en admin-bruker med denne e-posten." },
        { status: 409 }
      );
    }
    patch.email = email;
  }

  if (body.role !== undefined) {
    const role = body.role.trim() as AdminRole;
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: "Ugyldig rolle." }, { status: 400 });
    }
    if (target.id === session.sub) {
      return NextResponse.json(
        { error: "Du kan ikke endre din egen rolle. Be en annen full administrator om det." },
        { status: 400 }
      );
    }
    if (target.role === "full" && role !== "full") {
      const remainingFullAdmins = users.filter((u) => u.role === "full" && u.id !== id).length;
      if (remainingFullAdmins === 0) {
        return NextResponse.json(
          { error: "Dette er den siste fulle administratoren. Gjør en annen bruker til full administrator først." },
          { status: 400 }
        );
      }
    }
    patch.role = role;
  }

  if (Object.keys(patch).length > 0) {
    await repo.updateAdminUser(id, patch);
  }

  if (body.password !== undefined && body.password !== "") {
    if (body.password.length < 8) {
      return NextResponse.json({ error: "Det nye passordet bør være minst 8 tegn." }, { status: 400 });
    }
    const { hash, salt } = await hashPassword(body.password);
    await repo.updateAdminPassword(id, hash, salt);
  }

  const updatedUsers = await repo.listAdminUsers();
  const updated = updatedUsers.find((u) => u.id === id);
  return NextResponse.json({
    ok: true,
    user: updated
      ? { id: updated.id, name: updated.name, email: updated.email, role: updated.role, createdAt: updated.createdAt }
      : null,
  });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({ error: "Ikke innlogget." }, { status: 401 });

  const { id } = await params;

  if (id === session.sub) {
    return NextResponse.json(
      { error: "Du kan ikke slette din egen bruker. Be en annen full administrator om det." },
      { status: 400 }
    );
  }

  const repo = await getRepository();
  const users = await repo.listAdminUsers();
  const target = users.find((u) => u.id === id);
  if (!target) {
    return NextResponse.json({ error: "Fant ingen admin-bruker med denne iden." }, { status: 404 });
  }

  if (target.role === "full") {
    const remainingFullAdmins = users.filter((u) => u.role === "full" && u.id !== id).length;
    if (remainingFullAdmins === 0) {
      return NextResponse.json(
        { error: "Dette er den siste fulle administratoren og kan ikke slettes." },
        { status: 400 }
      );
    }
  }

  await repo.deleteAdminUser(id);
  return NextResponse.json({ ok: true });
}
