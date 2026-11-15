import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { setPasswordResetNotice } from "@/lib/settings/passwordResetNotice";

export const dynamic = "force-dynamic";

interface Body {
  email?: string;
}

/**
 * POST /api/admin/forgot-password
 *
 * Offentlig (ingen innlogging kreves – kalles fra innloggingssiden, se
 * LoginForm.tsx) – unntatt fra middleware.ts sin ellers strenge "krever
 * gyldig sesjon"-sjekk for /api/admin/**, på nøyaktig samme måte som
 * /api/admin/login selv.
 *
 * Lagrer et varsel (navn + e-post + tidspunkt) som vises øverst på ALLE
 * admin-sider for andre innloggede administratorer (se AdminNav.tsx +
 * lib/settings/passwordResetNotice.ts), helt til noen trykker bort det der.
 *
 * Svarer med samme generiske suksessmelding uansett om e-posten faktisk
 * tilhører en admin-bruker eller ikke – akkurat som /api/admin/login sin
 * "Feil e-post eller passord"-feil er lik uansett årsak – slik at
 * innloggingssiden ikke kan brukes til å sjekke hvilke e-postadresser som
 * finnes som admin-brukere.
 */
export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() ?? "";

  if (email && email.includes("@")) {
    try {
      const repo = await getRepository();
      const user = await repo.getAdminByEmail(email);
      if (user) {
        await setPasswordResetNotice({
          name: user.name,
          email: user.email,
          requestedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error("[forgot-password] kunne ikke lagre varsel:", err);
    }
  }

  return NextResponse.json({
    ok: true,
    message: "Hvis e-posten tilhører en administrator, er de andre administratorene varslet.",
  });
}
