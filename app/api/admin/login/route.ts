import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionCookieValue, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

interface LoginBody {
  email?: string;
  password?: string;
}

export async function POST(request: NextRequest) {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";

  if (!email || !password) {
    return NextResponse.json({ error: "E-post og passord er påkrevd." }, { status: 400 });
  }

  const repo = await getRepository();
  const user = await repo.getAdminByEmail(email);

  // Bevisst samme feilmelding uansett om det er e-posten eller passordet som
  // er feil, slik at ingen kan bruke innloggingssiden til å sjekke hvilke
  // e-postadresser som finnes som admin-brukere.
  const genericError = () =>
    NextResponse.json({ error: "Feil e-post eller passord." }, { status: 401 });

  if (!user) return genericError();

  const passwordOk = await verifyPassword(password, user.passwordHash, user.passwordSalt);
  if (!passwordOk) return genericError();

  const cookieValue = await createSessionCookieValue(user);
  const response = NextResponse.json({ ok: true, name: user.name });

  response.cookies.set(SESSION_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return response;
}
