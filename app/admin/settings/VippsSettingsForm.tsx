"use client";

import { useEffect, useState, type FormEvent } from "react";
import styles from "../admin.module.css";
import { formatOslo } from "@/lib/formatting";
import AdminNav from "../AdminNav";

type Environment = "test" | "production";

interface VippsStatus {
  configured: boolean;
  environment: Environment | null;
  clientIdMasked: string | null;
  msn: string | null;
  webhookRegistered: boolean;
  savedAt: string | null;
  active: boolean;
  encryptionReady: boolean;
}

export default function VippsSettingsForm() {
  const [status, setStatus] = useState<VippsStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const [environment, setEnvironment] = useState<Environment>("test");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [subscriptionKey, setSubscriptionKey] = useState("");
  const [msn, setMsn] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [callbackUrl, setCallbackUrl] = useState("");
  const [registeringWebhook, setRegisteringWebhook] = useState(false);
  const [webhookMessage, setWebhookMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [activating, setActivating] = useState(false);
  const [activateMessage, setActivateMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function loadStatus() {
    setLoadingStatus(true);
    try {
      const res = await fetch("/api/admin/settings/vipps", { cache: "no-store" });
      const data = (await res.json()) as VippsStatus;
      setStatus(data);
      // Forhåndsvelg samme miljø som er lagret, slik at man ikke ved et
      // uhell bytter fra produksjon til test bare ved å oppdatere f.eks. MSN.
      if (data.environment) setEnvironment(data.environment);
    } finally {
      setLoadingStatus(false);
    }
  }

  useEffect(() => {
    loadStatus();
    if (typeof window !== "undefined") {
      setCallbackUrl(`${window.location.origin}/api/squash/vipps-webhook`);
    }
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMessage(null);

    try {
      const res = await fetch("/api/admin/settings/vipps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment, clientId, clientSecret, subscriptionKey, msn }),
      });
      const data = (await res.json()) as { error?: string; status?: VippsStatus };

      if (!res.ok) {
        setSaveMessage({ ok: false, text: data.error ?? "Kunne ikke lagre." });
        return;
      }

      setClientId("");
      setClientSecret("");
      setSubscriptionKey("");
      setMsn("");
      setSaveMessage({ ok: true, text: "Vipps-nøklene er lagret (kryptert)." });
      if (data.status) setStatus(data.status);
      setTestMessage(null);
    } catch {
      setSaveMessage({ ok: false, text: "Kunne ikke lagre akkurat nå." });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestMessage(null);
    try {
      const res = await fetch("/api/admin/settings/vipps/test", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; message?: string };
      setTestMessage(
        data.ok
          ? { ok: true, text: "Tilkoblingen fungerer – hentet gyldig token fra Vipps." }
          : { ok: false, text: data.message ?? "Tilkoblingen feilet." }
      );
    } catch {
      setTestMessage({ ok: false, text: "Kunne ikke teste akkurat nå." });
    } finally {
      setTesting(false);
    }
  }

  async function handleRegisterWebhook() {
    setRegisteringWebhook(true);
    setWebhookMessage(null);
    try {
      const res = await fetch("/api/admin/settings/vipps/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callbackUrl }),
      });
      const data = (await res.json()) as { error?: string; status?: VippsStatus };
      if (!res.ok) {
        setWebhookMessage({ ok: false, text: data.error ?? "Klarte ikke å registrere webhook." });
        return;
      }
      setWebhookMessage({ ok: true, text: "Webhook registrert hos Vipps." });
      if (data.status) setStatus(data.status);
    } catch {
      setWebhookMessage({ ok: false, text: "Kunne ikke registrere webhook akkurat nå." });
    } finally {
      setRegisteringWebhook(false);
    }
  }

  async function handleActivate(nextActive: boolean) {
    if (nextActive) {
      const sure = window.confirm(
        "Dette slår PÅ ekte Vipps-betaling – kunder vil betale med ekte penger. Er du sikker?"
      );
      if (!sure) return;
    }

    setActivating(true);
    setActivateMessage(null);
    try {
      const res = await fetch("/api/admin/settings/vipps/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: nextActive }),
      });
      const data = (await res.json()) as { error?: string; status?: VippsStatus };
      if (!res.ok) {
        setActivateMessage({ ok: false, text: data.error ?? "Kunne ikke endre." });
        return;
      }
      setActivateMessage({ ok: true, text: nextActive ? "Ekte Vipps-betaling er nå PÅ." : "Byttet tilbake til simulert betaling." });
      if (data.status) setStatus(data.status);
    } catch {
      setActivateMessage({ ok: false, text: "Kunne ikke endre akkurat nå." });
    } finally {
      setActivating(false);
    }
  }

  return (
    <>
      <AdminNav active="vipps" />
      <main className={styles.page}>
        <div className={styles.tabPanel}>
          <h1 className={styles.title}>Vipps</h1>
          <p className={styles.subtitle}>Sett opp betaling direkte her, uten å røre kode eller miljøvariabler.</p>

      <div className={styles.card}>
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Status</h2>
        {loadingStatus && <p>Laster …</p>}
        {!loadingStatus && status && (
          <>
            {!status.encryptionReady && (
              <p className={styles.error}>
                Serveren er ikke satt opp for å lagre nøkler trygt ennå (miljøvariabelen
                SETTINGS_ENCRYPTION_KEY mangler). Be utvikleren sette denne én gang – se README. Du kan ikke
                lagre Vipps-nøkler her før dette er på plass.
              </p>
            )}
            <p>
              <span className={`${styles.badge} ${status.active ? styles.badgeConfirmed : styles.badgeBlock}`}>
                {status.active ? "AKTIV – ekte Vipps-betaling" : "Simulert betaling (mock)"}
              </span>
            </p>
            {status.configured ? (
              <p className={styles.bookingMeta}>
                Miljø: <strong>{status.environment === "production" ? "Produksjon" : "Test"}</strong> · Client ID:{" "}
                {status.clientIdMasked} · MSN: {status.msn} · Webhook:{" "}
                {status.webhookRegistered ? "registrert" : "ikke registrert ennå"}
                {status.savedAt && <> · sist lagret {formatOslo(status.savedAt, "d. MMM yyyy 'kl.' HH:mm")}</>}
              </p>
            ) : (
              <p className={styles.bookingMeta}>Ingen Vipps-nøkler lagret ennå.</p>
            )}
          </>
        )}
      </div>

      <div className={styles.card}>
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>1. Sett Vipps-nøkler</h2>
        <p className={styles.bookingMeta}>
          Hentes fra portal.vippsmobilepay.com → velg salgsenheten deres → &quot;For utviklere&quot;. Lagres
          kryptert i databasen – ingen andre enn serveren kan lese dem, og de vises aldri i klartekst her igjen
          etter lagring.
        </p>
        <form onSubmit={handleSave} className={styles.form}>
          <div className={styles.formRow}>
            <label htmlFor="vipps-env">Miljø</label>
            <select
              id="vipps-env"
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as Environment)}
              style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--border)" }}
            >
              <option value="test">Test (apitest.vipps.no) – anbefalt til dere har testet ferdig</option>
              <option value="production">Produksjon (ekte penger)</option>
            </select>
          </div>
          <div className={styles.formRow}>
            <label htmlFor="vipps-client-id">Client ID</label>
            <input id="vipps-client-id" type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
          </div>
          <div className={styles.formRow}>
            <label htmlFor="vipps-client-secret">Client Secret</label>
            <input
              id="vipps-client-secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className={styles.formRow}>
            <label htmlFor="vipps-subscription-key">Subscription key (Ocp-Apim-Subscription-Key)</label>
            <input
              id="vipps-subscription-key"
              type="password"
              value={subscriptionKey}
              onChange={(e) => setSubscriptionKey(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className={styles.formRow}>
            <label htmlFor="vipps-msn">Merchant Serial Number (MSN)</label>
            <input id="vipps-msn" type="text" value={msn} onChange={(e) => setMsn(e.target.value)} autoComplete="off" />
          </div>

          {saveMessage && <p className={saveMessage.ok ? styles.bookingMeta : styles.error}>{saveMessage.text}</p>}

          <button type="submit" className={styles.submitButton} disabled={saving || !status?.encryptionReady}>
            {saving ? "Lagrer …" : "Lagre nøkler"}
          </button>
        </form>
      </div>

      <div className={styles.card}>
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>2. Test tilkoblingen</h2>
        <p className={styles.bookingMeta}>Henter et ekte access-token fra Vipps med nøklene som er lagret over, uten å røre noen betalinger.</p>
        <button type="button" className={styles.secondaryButton} onClick={handleTest} disabled={testing || !status?.configured}>
          {testing ? "Tester …" : "Test tilkobling"}
        </button>
        {testMessage && <p className={testMessage.ok ? styles.bookingMeta : styles.error} style={{ marginTop: 10 }}>{testMessage.text}</p>}
      </div>

      <div className={styles.card}>
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>3. Registrer webhook</h2>
        <p className={styles.bookingMeta}>
          Forteller Vipps hvor den skal varsle appen når en betaling endrer status. Gjøres én gang per miljø
          (test/produksjon).
        </p>
        <div className={styles.formRow}>
          <label htmlFor="webhook-url">Callback-URL</label>
          <input id="webhook-url" type="text" value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} />
        </div>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={handleRegisterWebhook}
          disabled={registeringWebhook || !status?.configured}
        >
          {registeringWebhook ? "Registrerer …" : "Registrer webhook"}
        </button>
        {webhookMessage && (
          <p className={webhookMessage.ok ? styles.bookingMeta : styles.error} style={{ marginTop: 10 }}>
            {webhookMessage.text}
          </p>
        )}
      </div>

      <div className={styles.card}>
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>4. Aktiver Vipps</h2>
        <p className={styles.bookingMeta}>
          Så lenge dette står av bruker bookingsiden simulert betaling (ingen ekte penger, uansett hvilke
          nøkler som er lagret over) – trygt å la stå av helt til dere har testet ferdig.
        </p>
        {status?.active ? (
          <button type="button" className={styles.dangerButton} onClick={() => handleActivate(false)} disabled={activating}>
            {activating ? "Bytter …" : "Slå av – tilbake til simulert betaling"}
          </button>
        ) : (
          <button
            type="button"
            className={styles.submitButton}
            onClick={() => handleActivate(true)}
            disabled={activating || !status?.configured}
          >
            {activating ? "Aktiverer …" : "Aktiver ekte Vipps-betaling"}
          </button>
        )}
        {activateMessage && (
          <p className={activateMessage.ok ? styles.bookingMeta : styles.error} style={{ marginTop: 10 }}>
            {activateMessage.text}
          </p>
        )}
      </div>
        </div>
      </main>
    </>
  );
}
