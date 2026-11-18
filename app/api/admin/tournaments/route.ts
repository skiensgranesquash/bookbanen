import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { isValidDateString } from "@/lib/settings/openingHours";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/tournaments – lister alle turneringer (nyeste først).
 * POST /api/admin/tournaments – opprett en ny turnering.
 *
 * Beskyttet av middleware.ts – IKKE i noen av BOOKINGS_ONLY_ALLOWED_*-listene
 * der, så en begrenset ("bookings_only") administrator nektes automatisk,
 * akkurat som resten av Oppsett/Vipps/Utseende/Koder.
 */
export async function GET() {
  try {
    const repo = await getRepository();
    const tournaments = await repo.listTournaments();
    return NextResponse.json({ tournaments });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Kunne ikke hente turneringer." },
      { status: 500 }
    );
  }
}

interface CreateBody {
  name?: string;
  code?: string;
  active?: boolean;
  expiresAt?: string | null;
}

export async function POST(request: NextRequest) {
  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  const name = body.name?.trim() ?? "";
  const code = body.code?.trim() ?? "";
  const active = body.active === true;
  const expiresAt = body.expiresAt ? body.expiresAt : null;

  if (name.length < 2 || name.length > 100) {
    return NextResponse.json({ error: "Navn må være mellom 2 og 100 tegn." }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: "Skriv inn en kode for turneringen." }, { status: 400 });
  }
  if (expiresAt !== null && !isValidDateString(expiresAt)) {
    return NextResponse.json({ error: "Ugyldig utløpsdato (forventet format ÅÅÅÅ-MM-DD)." }, { status: 400 });
  }

  try {
    const repo = await getRepository();
    const existing = await repo.listTournaments();
    const codeLower = code.toLowerCase();
    if (existing.some((t) => t.code.trim().toLowerCase() === codeLower)) {
      return NextResponse.json({ error: "En annen turnering bruker allerede denne koden." }, { status: 400 });
    }

    const tournament = await repo.createTournament({ name, code, active, expiresAt });
    return NextResponse.json({ tournament });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Kunne ikke opprette turnering." },
      { status: 400 }
    );
  }
}
