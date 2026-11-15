import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionCookieValue } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Ikke innlogget." }, { status: 401 });
  }
  // `id` (session.sub) er med slik at Administratorer-fanen (se
  // AccountSettings.tsx) kan vite hvilken rad i listen er "meg selv" og
  // skjule Rediger/Slett der - handheves uansett pa nytt server-side i
  // app/api/admin/account/users/[id]/route.ts, uavhengig av hva UI-et viser.
  return NextResponse.json({ id: session.sub, name: session.name, email: session.email, role: session.role });
}
