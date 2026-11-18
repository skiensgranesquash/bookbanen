"use client";

import { useEffect, useState, type FormEvent } from "react";
import styles from "../../admin.module.css";
import { formatOslo } from "@/lib/formatting";
import AdminNav from "../../AdminNav";
import KoderTabs from "../KoderTabs";

interface Tournament {
  id: string;
  name: string;
  code: string;
  active: boolean;
  expiresAt: string | null;
  createdAt: string;
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
  tournamentId: string | null;
  slots: SlotInfo[];
}

const STATUS_LABEL: Record<MatchStatus, string> = {
  pending: "Venter",
  confirmed: "Bekreftet",
  cancelled: "Avlyst",
  expired: "Utløpt",
};

interface TournamentFormState {
  name: string;
  code: string;
  active: boolean;
  expiresAt: string;
}

const EMPTY_FORM: TournamentFormState = { name: "", code: "", active: false, expiresAt: "" };

/**
 * "Turneringer" – underfane under Koder (se app/admin/koder/KoderTabs.tsx).
 * Admin kan nå lage FLERE turneringer (i stedet for ett delt sett med
 * innstillinger, se den gamle app/admin/turnering/TournamentManager.tsx) –
 * hver med sin egen kode/av-på-bryter/utløpsdato, og se/avlyse kampene
 * booket med akkurat DEN turneringen (ekspanderbar liste per rad).
 */
export default function TournamentsManager() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loadingTournaments, setLoadingTournaments] = useState(true);

  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<TournamentFormState>(EMPTY_FORM);
  const [createMessage, setCreateMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingCreate, setSavingCreate] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<TournamentFormState>(EMPTY_FORM);
  const [editMessage, setEditMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [matches, setMatches] = useState<TournamentMatch[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function loadTournaments() {
    setLoadingTournaments(true);
    try {
      const res = await fetch("/api/admin/tournaments", { cache: "no-store" });
      const data = (await res.json()) as { tournaments: Tournament[] };
      setTournaments(data.tournaments ?? []);
    } finally {
      setLoadingTournaments(false);
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
      // lib/db/types.ts), så vi filtrerer på det her, og videre på
      // tournamentId per turnering nedenfor.
      setMatches((data.bookings ?? []).filter((b) => !!b.opponentName));
    } finally {
      setLoadingMatches(false);
    }
  }

  useEffect(() => {
    loadTournaments();
    loadMatches();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSavingCreate(true);
    setCreateMessage(null);
    try {
      const res = await fetch("/api/admin/tournaments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...createForm, expiresAt: createForm.expiresAt || null }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setCreateMessage({ ok: false, text: data.error ?? "Kunne ikke opprette turnering." });
        return;
      }
      setCreateForm(EMPTY_FORM);
      setCreating(false);
      setCreateMessage(null);
      await loadTournaments();
    } catch {
      setCreateMessage({ ok: false, text: "Kunne ikke opprette turnering akkurat nå." });
    } finally {
      setSavingCreate(false);
    }
  }

  function startEdit(t: Tournament) {
    setEditingId(t.id);
    setEditForm({ name: t.name, code: t.code, active: t.active, expiresAt: t.expiresAt ?? "" });
    setEditMessage(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditMessage(null);
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setSavingEdit(true);
    setEditMessage(null);
    try {
      const res = await fetch(`/api/admin/tournaments/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editForm, expiresAt: editForm.expiresAt || null }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setEditMessage({ ok: false, text: data.error ?? "Kunne ikke lagre." });
        return;
      }
      setEditingId(null);
      await loadTournaments();
    } catch {
      setEditMessage({ ok: false, text: "Kunne ikke lagre akkurat nå." });
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(t: Tournament) {
    if (
      !window.confirm(
        `Slette turneringen "${t.name}"? Dette kan ikke angres. Kamper som allerede er booket med den, beholdes.`
      )
    )
      return;

    setDeletingId(t.id);
    try {
      const res = await fetch(`/api/admin/tournaments/${t.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) window.alert(data.error ?? "Kunne ikke slette turneringen.");
      await loadTournaments();
    } finally {
      setDeletingId(null);
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
      <AdminNav active="koder" />
      <main className={styles.page}>
        <div className={styles.tabPanel}>
          <KoderTabs active="turneringer" />
          <h1 className={styles.title}>Turneringer</h1>
          <p className={styles.subtitle}>
            Hver turnering har sin egen kode – spillere som skriver inn en gyldig, aktiv kode når de booker en
            enkelttime, slipper å betale, og skriver i stedet inn hvem de møter.
          </p>

          <div className={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Alle turneringer</h2>
              {!creating && (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => {
                    setCreating(true);
                    setCreateForm(EMPTY_FORM);
                    setCreateMessage(null);
                  }}
                >
                  + Ny turnering
                </button>
              )}
            </div>

            {creating && (
              <form onSubmit={handleCreate} className={styles.form} style={{ marginTop: 12, marginBottom: 16 }}>
                <div className={styles.formRow}>
                  <label htmlFor="new-tournament-name">Navn</label>
                  <input
                    id="new-tournament-name"
                    type="text"
                    maxLength={100}
                    value={createForm.name}
                    onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="F.eks. Høstturneringen 2026"
                  />
                </div>
                <div className={styles.formRow}>
                  <label htmlFor="new-tournament-code">Kode spillerne skriver inn</label>
                  <input
                    id="new-tournament-code"
                    type="text"
                    maxLength={50}
                    value={createForm.code}
                    onChange={(e) => setCreateForm((f) => ({ ...f, code: e.target.value }))}
                    placeholder="F.eks. HOST2026"
                  />
                </div>
                <label className={styles.checkboxOption}>
                  <input
                    type="checkbox"
                    checked={createForm.active}
                    onChange={(e) => setCreateForm((f) => ({ ...f, active: e.target.checked }))}
                  />
                  Koden er aktiv (spillere kan bruke den nå)
                </label>
                <div className={styles.formRow}>
                  <label htmlFor="new-tournament-expires">Utløpsdato (valgfritt)</label>
                  <input
                    id="new-tournament-expires"
                    type="date"
                    value={createForm.expiresAt}
                    onChange={(e) => setCreateForm((f) => ({ ...f, expiresAt: e.target.value }))}
                  />
                  <p className={styles.bookingMeta}>La stå tom for ingen utløpsdato.</p>
                </div>

                {createMessage && (
                  <p className={createMessage.ok ? styles.success : styles.error}>{createMessage.text}</p>
                )}

                <div style={{ display: "flex", gap: 8 }}>
                  <button type="submit" className={styles.submitButton} disabled={savingCreate}>
                    {savingCreate ? "Lagrer …" : "Opprett"}
                  </button>
                  <button type="button" className={styles.secondaryButton} onClick={() => setCreating(false)}>
                    Avbryt
                  </button>
                </div>
              </form>
            )}

            {loadingTournaments ? (
              <p>Laster …</p>
            ) : tournaments.length === 0 ? (
              <p className={styles.bookingMeta}>Ingen turneringer opprettet ennå.</p>
            ) : (
              <div className={styles.userList}>
                {tournaments.map((t) => (
                  <div key={t.id}>
                    {editingId === t.id ? (
                      <form
                        onSubmit={handleSaveEdit}
                        className={styles.form}
                        style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}
                      >
                        <div className={styles.formRow}>
                          <label htmlFor="edit-tournament-name">Navn</label>
                          <input
                            id="edit-tournament-name"
                            type="text"
                            maxLength={100}
                            value={editForm.name}
                            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                          />
                        </div>
                        <div className={styles.formRow}>
                          <label htmlFor="edit-tournament-code">Kode spillerne skriver inn</label>
                          <input
                            id="edit-tournament-code"
                            type="text"
                            maxLength={50}
                            value={editForm.code}
                            onChange={(e) => setEditForm((f) => ({ ...f, code: e.target.value }))}
                          />
                        </div>
                        <label className={styles.checkboxOption}>
                          <input
                            type="checkbox"
                            checked={editForm.active}
                            onChange={(e) => setEditForm((f) => ({ ...f, active: e.target.checked }))}
                          />
                          Koden er aktiv (spillere kan bruke den nå)
                        </label>
                        <div className={styles.formRow}>
                          <label htmlFor="edit-tournament-expires">Utløpsdato (valgfritt)</label>
                          <input
                            id="edit-tournament-expires"
                            type="date"
                            value={editForm.expiresAt}
                            onChange={(e) => setEditForm((f) => ({ ...f, expiresAt: e.target.value }))}
                          />
                          <p className={styles.bookingMeta}>La stå tom for ingen utløpsdato.</p>
                        </div>

                        {editMessage && (
                          <p className={editMessage.ok ? styles.success : styles.error}>{editMessage.text}</p>
                        )}

                        <div style={{ display: "flex", gap: 8 }}>
                          <button type="submit" className={styles.submitButton} disabled={savingEdit}>
                            {savingEdit ? "Lagrer …" : "Lagre"}
                          </button>
                          <button type="button" className={styles.secondaryButton} onClick={cancelEdit}>
                            Avbryt
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className={styles.userRow}>
                        <div>
                          <strong>{t.name}</strong>
                          <div className={styles.bookingMeta}>
                            Kode: {t.code} · {t.active ? "Aktiv" : "Ikke aktiv"}
                            {t.expiresAt ? ` · Utløper ${t.expiresAt}` : ""}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                          >
                            {expandedId === t.id ? "Skjul kamper" : "Vis kamper"}
                          </button>
                          <button type="button" className={styles.secondaryButton} onClick={() => startEdit(t)}>
                            Rediger
                          </button>
                          <button
                            type="button"
                            className={styles.dangerButton}
                            disabled={deletingId === t.id}
                            onClick={() => handleDelete(t)}
                          >
                            {deletingId === t.id ? "Sletter …" : "Slett"}
                          </button>
                        </div>
                      </div>
                    )}

                    {expandedId === t.id && editingId !== t.id && (
                      <div className={styles.tournamentMatchesPanel}>
                        {loadingMatches && <p className={styles.bookingMeta}>Laster kamper …</p>}
                        {!loadingMatches && matches.filter((m) => m.tournamentId === t.id).length === 0 && (
                          <p className={styles.bookingMeta}>Ingen kamper booket i denne turneringen ennå.</p>
                        )}
                        {!loadingMatches && matches.filter((m) => m.tournamentId === t.id).length > 0 && (
                          <div className={styles.userList}>
                            {matches
                              .filter((m) => m.tournamentId === t.id)
                              .map((m) => (
                                <div key={m.id} className={styles.userRow}>
                                  <div>
                                    <strong>
                                      {m.customerName} vs {m.opponentName}
                                    </strong>
                                    <div className={styles.bookingMeta}>
                                      {m.slots
                                        .map((s) => formatOslo(s.startTime, "EEEE d. MMM yyyy 'kl.' HH:mm"))
                                        .join(", ")}
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
