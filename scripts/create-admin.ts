import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getRepository } from "../lib/db";
import { hashPassword } from "../lib/auth/password";
import type { AdminRole } from "../lib/db/types";

/**
 * Oppretter den aller første (eller en ekstra) admin-bruker direkte i
 * databasen – det finnes ingen "registrer deg"-side i adminpanelet med
 * vilje (kun innlogging), så dette skriptet er eneste vei inn første gang.
 * For å legge til FLERE administratorer senere (inkl. en begrenset
 * "bookings_only"-administrator, se AdminRole i lib/db/types.ts) kan man
 * også bruke "Legg til ny admin-bruker" under Min konto i selve
 * adminpanelet – dette skriptet trengs da ikke lenger.
 *
 * Kjøres med: npm run create-admin -- <e-post> <navn> <passord> [rolle]
 *   "rolle" er valgfri: "full" (standard) eller "bookings_only".
 *
 * For å opprette brukeren i PRODUKSJONS-databasen (Supabase), sett de riktige
 * miljøvariablene foran kommandoen, f.eks.:
 *
 *   DB_DRIVER=supabase SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role-nøkkelen> \
 *   npm run create-admin -- "admin@klubb.no" "Admin Adminsen" "et-sterkt-passord"
 *
 * Uten disse (dvs. bare "npm run create-admin -- ...") brukes verdiene i
 * .env.local i stedet – som normalt betyr den lokale JSON-databasen
 * (data/db.json), fin til lokal testing av innlogging.
 */

function loadDotEnvLocal(): void {
  try {
    const path = resolve(process.cwd(), ".env.local");
    const content = readFileSync(path, "utf8");
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Miljøvariabler satt i selve kommandoen (foran "npm run ...") skal
      // alltid vinne over .env.local, derfor settes de kun hvis de IKKE
      // allerede finnes.
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // Ingen .env.local – helt greit, da må miljøvariablene allerede være satt
    // på annen måte (slik som i eksempelet over).
  }
}

async function main(): Promise<void> {
  loadDotEnvLocal();

  const [, , email, name, password, roleArg] = process.argv;
  if (!email || !name || !password) {
    console.error('Bruk: npm run create-admin -- "<e-post>" "<navn>" "<passord>" [rolle: full|bookings_only]');
    process.exitCode = 1;
    return;
  }

  const role: AdminRole = roleArg === "bookings_only" ? "bookings_only" : "full";
  if (roleArg && roleArg !== "full" && roleArg !== "bookings_only") {
    console.error(`Ukjent rolle "${roleArg}" – bruk "full" eller "bookings_only".`);
    process.exitCode = 1;
    return;
  }

  const repo = await getRepository();

  const existing = await repo.getAdminByEmail(email);
  if (existing) {
    console.error(`Det finnes allerede en admin-bruker med e-posten ${email}.`);
    process.exitCode = 1;
    return;
  }

  const { hash, salt } = await hashPassword(password);
  const user = await repo.createAdminUser({
    email,
    name,
    passwordHash: hash,
    passwordSalt: salt,
    role,
  });

  console.log(`Admin-bruker opprettet: ${user.name} <${user.email}> (id: ${user.id}, rolle: ${user.role})`);
}

main().catch((err) => {
  console.error("Feil under opprettelse av admin-bruker:", err);
  process.exitCode = 1;
});
