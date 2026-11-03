import "server-only";
import { getRepository } from "@/lib/db";

/**
 * Hvor mange minutter en booking admin har SENDT BETALINGSFORESPØRSEL for
 * (se app/api/admin/bookings/manual/route.ts, "Be om betaling via Vipps")
 * holdes av før den automatisk frigjøres igjen hvis kunden ikke har betalt.
 * Helt uavhengig av HOLD_MINUTES i lib/config.ts (som styrer den vanlige,
 * kundestyrte selvbetjenings-bookingen på bookingsiden - der forventes
 * betaling i løpet av noen minutter, mens en betalingsforespørsel fra admin
 * ofte sendes i forkant, og kunden betaler kanskje ikke med en gang).
 *
 * Satt av klubben i Innstillinger → Vipps (se
 * app/admin/settings/VippsSettingsForm.tsx). Lagret i samme generiske
 * nøkkel/verdi-tabell som resten av innstillingene (se
 * lib/settings/recurringLimit.ts for samme mønster). `null`/ingen verdi
 * lagret ennå betyr DEFAULT_ADMIN_PAYMENT_HOLD_MINUTES under.
 */
const KEY = "adminPaymentRequestHoldMinutes";
export const DEFAULT_ADMIN_PAYMENT_HOLD_MINUTES = 10;
/** Øvre grense - rent for å unngå å låse banen i ukesvis ved en tastefeil. */
const MAX_MINUTES = 10_080; // 7 dager

export async function getAdminPaymentRequestHoldMinutes(): Promise<number> {
  const repo = await getRepository();
  const raw = await repo.getSetting(KEY);
  if (!raw) return DEFAULT_ADMIN_PAYMENT_HOLD_MINUTES;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MAX_MINUTES ? n : DEFAULT_ADMIN_PAYMENT_HOLD_MINUTES;
}

export async function saveAdminPaymentRequestHoldMinutes(minutes: number): Promise<number> {
  const repo = await getRepository();
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
    throw new Error(`Ugyldig antall minutter (må være et helt tall mellom 1 og ${MAX_MINUTES}).`);
  }
  await repo.setSetting(KEY, String(minutes));
  return minutes;
}
