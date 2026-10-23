import { NextRequest, NextResponse } from "next/server";
import { getActivePaymentProvider } from "@/lib/settings/vippsSettings";
import { getRepository } from "@/lib/db";

export const dynamic = "force-dynamic";

interface CompleteBody {
  reference?: string;
  outcome?: "approved" | "aborted";
}

/**
 * POST /api/squash/mock-payment/complete
 *
 * Kun tilgjengelig når betalingsleverandøren er "mock" (lokal testing).
 * Simulerer det en ekte Vipps-webhook ellers ville gjort: setter bookingen
 * til "confirmed" eller "cancelled" med én gang brukeren klikker i den
 * simulerte Vipps-siden (se app/squash/booking/mock-vipps).
 *
 * Denne ruten ville vært et alvorlig sikkerhetshull i ekte drift (hvem som
 * helst kunne "bekreftet" en booking uten å betale) – derfor 403 hvis mock
 * ikke er den aktive leverandøren.
 */
export async function POST(request: NextRequest) {
  if ((await getActivePaymentProvider()) !== "mock") {
    return NextResponse.json({ error: "Kun tilgjengelig i lokal testmodus (Vipps er aktivert)." }, { status: 403 });
  }

  let body: CompleteBody;
  try {
    body = (await request.json()) as CompleteBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  if (!body.reference || (body.outcome !== "approved" && body.outcome !== "aborted")) {
    return NextResponse.json({ error: "Mangler reference/outcome." }, { status: 400 });
  }

  const repo = await getRepository();
  const group = await repo.getGroupByReference(body.reference);
  if (!group) {
    return NextResponse.json({ error: "Fant ingen booking med denne referansen." }, { status: 404 });
  }

  if (group.status !== "pending") {
    // Allerede avgjort (f.eks. dobbeltklikk) – bare fortell hva den ble.
    return NextResponse.json({ status: group.status });
  }

  const nextStatus = body.outcome === "approved" ? "confirmed" : "cancelled";
  const updated = await repo.updateGroupStatus(body.reference, nextStatus, "pending");

  return NextResponse.json({ status: updated?.status ?? nextStatus });
}
