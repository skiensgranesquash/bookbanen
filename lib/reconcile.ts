import "server-only";
import { getRepository } from "@/lib/db";
import { getPaymentProviderImpl } from "@/lib/payments";
import type { BookingGroupWithSlots } from "@/lib/db/types";

/**
 * Henter den kanoniske betalingsstatusen for en booking og oppdaterer
 * databasen deretter. Brukt av:
 * - webhooken fra Vipps (ekte modus)
 * - bekreftelsessiden når den poller status (begge moduser – i mock-modus
 *   er dette en rask, lokal sjekk siden /api/squash/mock-payment/complete
 *   allerede har satt riktig status)
 */
export async function reconcileBooking(reference: string): Promise<BookingGroupWithSlots | null> {
  const repo = await getRepository();
  const group = await repo.getGroupByReference(reference);
  if (!group) return null;

  // Allerede ferdig behandlet – ingenting å gjøre. Dette er også det som
  // demper hvor ofte vi faktisk kaller ut til Vipps når siden poller oss.
  if (group.status !== "pending") return group;

  const provider = await getPaymentProviderImpl();
  const outcome = await provider.reconcilePendingPayment({
    reference,
    amountOre: group.totalAmountOre,
  });

  if (outcome === "pending") return group;

  const updated = await repo.updateGroupStatus(reference, outcome, "pending");
  return updated ?? group;
}
