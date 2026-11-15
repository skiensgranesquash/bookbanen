"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import styles from "../admin.module.css";

export default function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/admin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // --- "Glemt passord?" - varsler de andre administratorene (se
  // app/admin/AdminNav.tsx + app/api/admin/forgot-password/route.ts), i
  // stedet for en ekte selvbetjent tilbakestilling (appen har ingen
  // e-posttjeneste å sende en lenke med). ---
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [sendingForgotPassword, setSendingForgotPassword] = useState(false);
  const [forgotPasswordMessage, setForgotPasswordMessage] = useState<string | null>(null);

  async function handleForgotPassword() {
    if (!email.trim() || !email.includes("@")) {
      setForgotPasswordMessage("Skriv inn e-posten din i feltet over først.");
      return;
    }

    setSendingForgotPassword(true);
    setForgotPasswordMessage(null);
    try {
      await fetch("/api/admin/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setForgotPasswordMessage("De andre administratorene er varslet, hvis e-posten tilhører en admin-bruker.");
    } catch {
      setForgotPasswordMessage("Kunne ikke sende varsel akkurat nå. Prøv igjen senere.");
    } finally {
      setSendingForgotPassword(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { error?: string };

      if (!res.ok) {
        setError(data.error ?? "Innlogging feilet.");
        setSubmitting(false);
        return;
      }

      // Hard navigasjon (IKKE router.push + router.refresh): sikrer at den
      // nye sesjonscookien faktisk er med i forespørselen som laster "next"-
      // siden, slik at middleware.ts ser den med en gang. Med bare
      // client-side-navigasjon kunne siden bli hengende på "Logger inn …"
      // til man oppdaterte siden manuelt.
      window.location.href = next;
    } catch {
      setError("Kunne ikke logge inn akkurat nå.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.formRow}>
        <label htmlFor="admin-email">E-post</label>
        <input
          id="admin-email"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className={styles.formRow}>
        <label htmlFor="admin-password">Passord</label>
        <input
          id="admin-password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <button type="submit" className={styles.submitButton} disabled={submitting}>
        {submitting ? "Logger inn …" : "Logg inn"}
      </button>

      <button
        type="button"
        className={styles.secondaryButton}
        style={{ marginTop: 10 }}
        onClick={() => {
          setShowForgotPassword((v) => !v);
          setForgotPasswordMessage(null);
        }}
      >
        Glemt passord?
      </button>

      {showForgotPassword && (
        <div className={styles.formRow} style={{ marginTop: 10 }}>
          <p className={styles.bookingMeta}>
            Vi har ingen automatisk tilbakestilling – trykk under for å varsle de andre administratorene,
            så kan en av dem sette et nytt passord for deg under Administratorer.
          </p>
          <button
            type="button"
            className={styles.submitButton}
            onClick={handleForgotPassword}
            disabled={sendingForgotPassword}
          >
            {sendingForgotPassword ? "Sender …" : "Send varsel til administratorene"}
          </button>
          {forgotPasswordMessage && <p className={styles.bookingMeta}>{forgotPasswordMessage}</p>}
        </div>
      )}
    </form>
  );
}
