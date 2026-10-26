import "server-only";
import { getRepository } from "@/lib/db";
import type { BookingDurationMinutes } from "@/lib/config";

/**
 * Pris for 30 minutter og pris for 1 time settes HELT uavhengig av hverandre
 * av klubben i adminpanelet (se app/admin/opening-hours/OpeningHoursManager.tsx,
 * kortet "Pris") – 1-timesprisen er altså IKKE nødvendigvis nøyaktig det
 * dobbelte av 30-minuttersprisen. Lagret i den samme generiske
 * nøkkel/verdi-innstillingstabellen som resten av innstillingene (se
 * lib/settings/recurringLimit.ts for samme mønster), som to separate nøkler.
 *
 * Standardverdiene under er kun en forhåndsutfylt startverdi FØR klubben har
 * lagret noe eget – tilsvarer den gamle, hardkodede prisen på 35 kr/time.
 */
const PRICE_30_MIN_KEY = "price30MinOre";
const PRICE_60_MIN_KEY = "price60MinOre";

const DEFAULT_PRICE_30_MIN_ORE = 1750; // 17,50 kr – halve den gamle timeprisen
const DEFAULT_PRICE_60_MIN_ORE = 3500; // 35 kr – den gamle timeprisen

export interface PricingSettings {
  price30MinOre: number;
  price60MinOre: number;
}

function parseStoredPriceOre(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

export async function getPricingSettings(): Promise<PricingSettings> {
  const repo = await getRepository();
  const [price30Raw, price60Raw] = await Promise.all([
    repo.getSetting(PRICE_30_MIN_KEY),
    repo.getSetting(PRICE_60_MIN_KEY),
  ]);

  return {
    price30MinOre: parseStoredPriceOre(price30Raw, DEFAULT_PRICE_30_MIN_ORE),
    price60MinOre: parseStoredPriceOre(price60Raw, DEFAULT_PRICE_60_MIN_ORE),
  };
}

function assertValidPriceOre(value: number, label: string) {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`Pris for ${label} må være et helt tall i øre, 0 eller høyere.`);
  }
}

export async function savePricingSettings(input: PricingSettings): Promise<PricingSettings> {
  assertValidPriceOre(input.price30MinOre, "30 minutter");
  assertValidPriceOre(input.price60MinOre, "1 time");

  const repo = await getRepository();
  await Promise.all([
    repo.setSetting(PRICE_30_MIN_KEY, String(input.price30MinOre)),
    repo.setSetting(PRICE_60_MIN_KEY, String(input.price60MinOre)),
  ]);

  return { price30MinOre: input.price30MinOre, price60MinOre: input.price60MinOre };
}

/** Pris for en gitt varighet, hentet fra de to uavhengige innstillingene over. */
export function priceForDuration(pricing: PricingSettings, durationMinutes: BookingDurationMinutes): number {
  return durationMinutes === 60 ? pricing.price60MinOre : pricing.price30MinOre;
}
