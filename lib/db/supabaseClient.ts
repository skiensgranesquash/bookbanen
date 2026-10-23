import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Server-only Supabase-klient med service role-nøkkelen. Se README for
 * hvorfor dette er trygt (nøkkelen brukes ALDRI i klientkode, og RLS uten
 * policies gjør en evt. feil-eksponert annen nøkkel ufarlig).
 *
 * Database-generic-en (se ./database.types) er nødvendig for nyere versjoner
 * av @supabase/supabase-js – uten den faller .insert()/.update()-typene
 * tilbake til `never`, som ga TS-feil på hele lib/db/supabase.ts.
 */
let cachedClient: ReturnType<typeof createClient<Database>> | null = null;

export function getSupabaseAdmin() {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY må være satt (DB_DRIVER=supabase krever disse)."
    );
  }

  cachedClient = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cachedClient;
}
