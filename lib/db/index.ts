import "server-only";
import { getDbDriver } from "@/lib/config";
import type { BookingRepository } from "./types";
import { localRepository } from "./local";

/**
 * Velger databasedriver basert på DB_DRIVER (se lib/config.ts).
 * Supabase-driveren importeres kun når den faktisk trengs (dynamisk import),
 * slik at @supabase/supabase-js aldri lastes/kreves i lokal utviklingsmodus.
 */
let cached: BookingRepository | null = null;
let cachedDriver: "local" | "supabase" | null = null;

export async function getRepository(): Promise<BookingRepository> {
  const driver = getDbDriver();
  if (cached && cachedDriver === driver) return cached;

  if (driver === "supabase") {
    const { supabaseRepository } = await import("./supabase");
    cached = supabaseRepository;
  } else {
    cached = localRepository;
  }
  cachedDriver = driver;
  return cached;
}
