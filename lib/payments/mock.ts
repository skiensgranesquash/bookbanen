import "server-only";
import type { PaymentProvider } from "./types";

/**
 * Simulert betaling for lokal testing – ingen nettverkskall, ingen ekte
 * Vipps-konto nødvendig. "Redirect-URL-en" peker til vår egen side
 * (/squash/booking/mock-vipps) som ser ut som en enkel Vipps-lignende
 * bekreftelsesdialog, der DU selv trykker "godkjenn" eller "avbryt".
 *
 * Byttes til lib/payments/vipps.ts ved å sette PAYMENT_PROVIDER=vipps (se
 * lib/config.ts og README).
 */
export const mockPaymentProvider: PaymentProvider = {
  async createPayment({ reference, amountOre, description, returnUrl }) {
    const params = new URLSearchParams({
      ref: reference,
      amount: String(amountOre),
      desc: description,
      returnUrl,
    });
    return { redirectUrl: `/squash/booking/mock-vipps?${params.toString()}` };
  },

  async reconcilePendingPayment() {
    // Bevisst no-op: mock-betalinger avgjøres direkte og synkront av
    // /api/squash/mock-payment/complete når brukeren klikker i den
    // simulerte Vipps-siden, ikke via polling/webhook slik ekte Vipps gjør.
    return "pending";
  },

  async refund(reference) {
    console.log(
      `[mock-payment] Simulerer refusjon for referanse ${reference} – ingen ekte penger er involvert i lokal testmodus.`
    );
  },
};
