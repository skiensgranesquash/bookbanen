import "server-only";
import { getRepository } from "@/lib/db";

/**
 * Frigjør "pending"-bookinger (personer som startet en betaling, men aldri
 * fullførte den) hvis holdet deres har gått ut. Kalles fra
 * availability/bookings-rutene (lat opprydding) og fra cron-expire (som et
 * sikkerhetsnett).
 */
export async function expireStaleHolds(): Promise<void> {
  const repo = await getRepository();
  await repo.expireStaleHolds();
}
