export interface CreatePaymentInput {
  reference: string;
  amountOre: number;
  /** Norsk mobilnummer uten landkode, f.eks. "91234567". */
  phoneNumber: string;
  description: string;
  returnUrl: string;
}

export type ReconcileOutcome = "confirmed" | "cancelled" | "pending";

/**
 * Felles grensesnitt for betalingsleverandører. To implementasjoner:
 * - lib/payments/mock.ts  (lokal simulering, se lib/config.ts#getPaymentProvider)
 * - lib/payments/vipps.ts (ekte Vipps ePayment API)
 */
export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<{ redirectUrl: string }>;

  /**
   * Henter den kanoniske statusen for en "pending" booking og returnerer hva
   * den bør bli. For Vipps innebærer dette å faktisk spørre Vipps' API (og
   * fange beløpet automatisk ved godkjenning). For mock-leverandøren er
   * dette alltid "pending" – status avgjøres i stedet direkte av
   * /api/squash/mock-payment/complete når brukeren klikker i den simulerte
   * Vipps-siden.
   */
  reconcilePendingPayment(params: { reference: string; amountOre: number }): Promise<ReconcileOutcome>;

  /** Refunderer en bekreftet betaling (brukt fra adminpanelet). */
  refund(reference: string, amountOre: number): Promise<void>;
}
