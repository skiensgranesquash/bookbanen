import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { isValidDateString } from "@/lib/settings/openingHours";

export const dynamic = "force-dynamic";

interface PatchBody {
  name?: string;
  code?: string;
  active?: boolean;
  expiresAt?: string | null;
}

/**
 * PATCH  /api/admin/tournaments/[id] – endre navn/kode/av-på/utløpsdato.
 * DELETE /api/admin/tournaments/[id] – slett turneringen (kamper allerede
 *        booket med den beholdes, se tournament_id i migrasjonen – "on
 *        delete set null").
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  const patch: { name?: string; code?: string; active?: boolean; expiresAt?: string | null } = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (name.length < 2 || name.length > 100) {
      return NextResponse.json({ error: "Navn må være mellom 2 og 100 tegn." }, { status: 400 });
    }
    patch.name = name;
  }

  if (body.code !== undefined) {
    const code = body.code.trim();
    if (!code) {
      return NextResponse.json({ error: "Skriv inn en kode for turneringen." }, { status: 400 });
    }
    patch.code = code;
  }

  if (body.active !== undefined) patch.active = body.active === true;

  if (body.expiresAt !== undefined) {
    const expiresAt = body.expiresAt ? body.expiresAt : null;
    if (expiresAt !== null && !isValidDateString(expiresAt)) {
      return NextResponse.json({ error: "Ugyldig utløpsdato (forventet format ÅÅÅÅ-MM-DD)." }, { status: 400 });
    }
    patch.expiresAt = expiresAt;
  }

  try {
    const repo = await getRepository();

    if (patch.code !== undefined) {
      const codeLower = patch.code.toLowerCase();
      const existing = await repo.listTournaments();
      if (existing.some((t) => t.id !== id && t.code.trim().toLowerCase() === codeLower)) {
        return NextResponse.json({ error: "En annen turnering bruker allerede denne koden." }, { status: 400 });
      }
    }

    const tournament = await repo.updateTournament(id, patch);
    return NextResponse.json({ tournament });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Kunne ikke oppdatere turnering." },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const repo = await getRepository();
    await repo.deleteTournament(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Kunne ikke slette turnering." },
      { status: 400 }
    );
  }
}
