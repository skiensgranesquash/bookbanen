import "server-only";
import { getRepository } from "@/lib/db";

/**
 * "Noen har glemt passordet sitt"-varselet som vises øverst på alle
 * admin-sider (se app/admin/AdminNav.tsx) etter at noen trykker "Glemt
 * passord?" på innloggingssiden (se app/admin/login/LoginForm.tsx +
 * app/api/admin/forgot-password/route.ts).
 *
 * Bevisst KUN ett varsel av gangen (ikke en liste/kø) – en delt "oppslagstavle"-
 * melding som HVEM SOM HELST innlogget administrator kan lukke, ikke en
 * personlig "ulest"-status per administrator. Lagret som JSON i den samme
 * generiske nøkkel/verdi-innstillingstabellen som resten av appen (se
 * lib/settings/pricing.ts for samme mønster) – ingen egen databasetabell
 * nødvendig for noe så enkelt som dette.
 */
const NOTICE_KEY = "pendingPasswordResetNotice";

export interface PasswordResetNotice {
  name: string;
  email: string;
  /** ISO-8601-tidspunkt. */
  requestedAt: string;
}

export async function getPasswordResetNotice(): Promise<PasswordResetNotice | null> {
  const repo = await getRepository();
  const raw = await repo.getSetting(NOTICE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PasswordResetNotice;
  } catch {
    return null;
  }
}

export async function setPasswordResetNotice(notice: PasswordResetNotice): Promise<void> {
  const repo = await getRepository();
  await repo.setSetting(NOTICE_KEY, JSON.stringify(notice));
}

export async function clearPasswordResetNotice(): Promise<void> {
  const repo = await getRepository();
  await repo.setSetting(NOTICE_KEY, "");
}
