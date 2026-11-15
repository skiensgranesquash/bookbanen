"use client";

import { useEffect, useState, type FormEvent } from "react";
import styles from "../admin.module.css";
import { formatOslo } from "@/lib/formatting";
import AdminNav from "../AdminNav";

interface TournamentSettingsResponse {
  code: string;
  active: boolean;
  expiresAt: string | null;
}

interface SlotInfo {
  startTime: string;
  endTime: string;
}

type MatchStatus = "pending" | "confirmed" | "cancelled" | "expired";

interface TournamentMatch {
  id: string;
  status: MatchStatus;
  customerName: string;
  opponentName: string | null;
  slots: SlotInfo[];
}

const STATUS_LABEL: Record<MatchStatus, string> = {
  pending: "Venter",
  confirmed: "Bekreftet",
  cancelled: "Avlyst",
  expired: "Utløpt",
};

/**
 * "Turnering" – egen fane (kun full administrator, se AdminNav.tsx og
 * middleware.ts) der admin setter opp den delte turneringskoden (se
 * lib/settings/tournament.ts) og ser kampene som er booket med den.
 */
export default function TournamentManager() {
  const [code, setCode] = useState("");
  const [active, setActive] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [matches, setMatches] = useState<TournamentMatch[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function loadSettings() {
    setLoadingSettings(true);
    try {
      const res = await fetch("/api/admin/settings/tournament", { cache: "no-store" });
      const data = (await res.json()) as TournamentSettingsResponse;
      setCode(data.code ?? "");
      setActive(!!data.active);
      setExpiresAt(data.expiresAt ?? "");
    } finally {
      setLoadingSettings(false);
    }
  }

  async function loadMatches() {
    setLoadingMatches(true);
    try {
      const res = await fetch("/api/admin/bookings", { cache: "no-store" });
      const data = (await res.json()) as { bookings: TournamentMatch[] };
      // Adminpanelets vanlige "alle bookinger"-endepunkt (se
      // app/api/admin/bookings/route.ts) – en turneringskamp er bare en
      // enkeltbooking som i tillegg har opponentName satt (se
      // lib/db/types.ts), så vi filtrerer på det her i stedet for å ha et
      // eget endepunkt kun for dette.
      setMatches((data.bookings ?? []).filter((b) => !!b.opponentName));
    } finally {
      setLoadingMatches(false);
    }
  }

  useEffect(() => {
    loadSettings();
    loadMatches();
  }, []);

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    setSavingSettings(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/admin/settings/tournament", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, active, expiresAt: expiresAt || null }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSaveMessage({ ok: false, text: data.error ?? "Kunne ikke lagre." });
        return;
      }
      setSaveMessage({ ok: true, text: "Lagret." });
    } catch {
      setSaveMessage({ ok: false, text: "Kunne ikke lagre akkurat nå." });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleCancelMatch(match: TournamentMatch) {
    const label = `${match.customerName} vs ${match.opponentName}`;
    if (!window.confirm(`Avlyse "${label}"? Dette kan ikke angres.`)) return;

    setCancellingId(match.id);
    try {
      const res = await fetch(`/api/admin/bookings/${match.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) window.alert(data.error ?? "Kunne ikke avlyse kampen.");
      await loadMatches();
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <>
      <AdminNav active="turnering" />
      <main className={styles.page}>
        <div className={styles.tabPanel}>
          <h1 className={styles.title}>Turnering</h1>
          <p className={styles.subtitle}>
            Spillere som skriver inn koden under når de booker en enkelttime, slipper å betale – de skriver i stedet
            inn hvem de møter. Bookingen vises som vanlig opptatt for alle andre, men blått og med motstander for deg
            her i adminpanelet.
          </p>

          <div className={styles.card}>
            <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Turneringskode</h2>
            {loadingSettings ? (
              <p>Laster …</p>
            ) : (
              <form onSubmit={handleSaveSettings} className={styles.form}>
                <div className={styles.formRow}>
                  <label htmlFor="tournament-settings-code">Kode spillerne skriver inn</label>
                  <input
                    id="tournament-settings-code"
                    type="text"
                    maxLength={50}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="F.eks. HOST2026"
                  />
                </div>

                <label className={styles.checkboxOption}>
                  <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                  Koden er aktiv (spillere kan bruke den nå)
                </label>

                <div className={styles.formRow}>
                  <label htmlFor="tournament-settings-expires">Utløpsdato (valgfritt)</label>
                  <input
                    id="tournament-settings-expires"
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                  />
                  <p className={styles.bookingMeta}>La stå tom for ingen utløpsdato.</p>
                </div>

                {saveMessage && <p className={saveMessage.ok ? styles.success : styles.error}>{saveMessage.text}</p>}

                <button type="submit" className={styles.submitButton} disabled={savingSettings}>
                  {savingSettings ? "Lagrer …" : "Lagre"}
                </button>
              </form>
            )}
          </div>

          <div className={styles.card}>
            <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Kamper i turneringen</h2>
            {loadingMatches && <p>Laster …</p>}
            {!loadingMatches && matches.length === 0 && (
              <p className={styles.bookingMeta}>Ingen turneringskamper bestilt ennå.</p>
            )}
            {!loadingMatches && matches.length > 0 && (
              <div className={styles.userList}>
                {matches.map((m) => (
                  <div key={m.id} className={styles.userRow}>
                    <div>
                      <strong>
                        {m.customerName} vs {m.opponentName}
                      </strong>
                      <div className={styles.bookingMeta}>
                        {m.slots.map((s) => formatOslo(s.startTime, "EEEE d. MMM yyyy 'kl.' HH:mm")).join(", ")}
                        {" · "}
                        {STATUS_LABEL[m.status]}
                      </div>
                    </div>
                    {(m.status === "pending" || m.status === "confirmed") && (
                      <button
                        type="button"
                        className={styles.dangerButton}
                        disabled={cancellingId === m.id}
                        onClick={() => handleCancelMatch(m)}
                      >
                        {cancellingId === m.id ? "Avlyser …" : "Avlys"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
