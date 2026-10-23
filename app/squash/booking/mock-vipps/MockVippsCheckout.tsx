"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import styles from "../booking.module.css";

function formatPrice(oreString: string | null): string {
  const ore = Number(oreString ?? "0");
  return `${(ore / 100).toLocaleString("nb-NO")} kr`;
}

export default function MockVippsCheckout() {
  const searchParams = useSearchParams();
  const reference = searchParams.get("ref");
  const amount = searchParams.get("amount");
  const description = searchParams.get("desc") ?? "";
  const returnUrl = searchParams.get("returnUrl");

  const [busy, setBusy] = useState<"approved" | "aborted" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function complete(outcome: "approved" | "aborted") {
    if (!reference || !returnUrl) {
      setError("Mangler referanse eller returadresse.");
      return;
    }

    setBusy(outcome);
    setError(null);

    try {
      const res = await fetch("/api/squash/mock-payment/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, outcome }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Noe gikk galt i simuleringen.");
        setBusy(null);
        return;
      }

      window.location.href = returnUrl;
    } catch {
      setError("Kunne ikke fullføre simuleringen.");
      setBusy(null);
    }
  }

  if (!reference || !returnUrl) {
    return (
      <div className={styles.card}>
        <p className={styles.error}>Ugyldig lenke – mangler referanse eller returadresse.</p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Simulert Vipps-dialog
      </p>
      <p style={{ fontSize: "1.1rem", margin: "8px 0" }}>{description}</p>
      <p style={{ fontSize: "1.75rem", fontWeight: 700, margin: "8px 0 20px" }}>{formatPrice(amount)}</p>

      {error && <p className={styles.error}>{error}</p>}

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button
          type="button"
          className={styles.submitButton}
          disabled={busy !== null}
          onClick={() => complete("approved")}
        >
          {busy === "approved" ? "Godkjenner …" : "✅ Godkjenn betaling (simulert)"}
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={busy !== null}
          onClick={() => complete("aborted")}
        >
          {busy === "aborted" ? "Avbryter …" : "❌ Avbryt betaling (simulert)"}
        </button>
      </div>
    </div>
  );
}
