import { NextRequest, NextResponse } from "next/server";
import { getPageContent, savePageContent } from "@/lib/settings/pageContent";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/settings/content – hent gjeldende tekster på bookingsiden
 *      (medlemskapsnotisen og bunnteksten), som sanert rik-tekst-HTML (fet/
 *      kursiv/understreket/lenke) – se lib/settings/pageContent.ts.
 * POST /api/admin/settings/content – lagre én eller begge tekstene. Sett en
 *      verdi til null for å tilbakestille akkurat den teksten til standard.
 *
 * Beskyttet av middleware.ts som resten av /api/admin/** – krever gyldig
 * admin-sesjon, og er (som resten av Utseende-fanen) IKKE i
 * BOOKINGS_ONLY_ALLOWED_API_*, så en begrenset administrator har ikke
 * tilgang til å endre disse tekstene.
 */
export async function GET() {
  try {
    const content = await getPageContent();
    return NextResponse.json(content);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Kunne ikke hente tekster." },
      { status: 500 }
    );
  }
}

interface SaveContentBody {
  membershipNoticeHtml?: string | null;
  footerHtml?: string | null;
}

export async function POST(request: NextRequest) {
  let body: SaveContentBody;
  try {
    body = (await request.json()) as SaveContentBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  try {
    const content = await savePageContent(body);
    return NextResponse.json({ ok: true, ...content });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Kunne ikke lagre." }, { status: 400 });
  }
}
