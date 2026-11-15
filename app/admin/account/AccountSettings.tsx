"use client";

import { useEffect, useState, type FormEvent } from "react";
import styles from "../admin.module.css";
import { formatOslo } from "@/lib/formatting";
import AdminNav from "../AdminNav";

type AdminRole = "full" | "bookings_only";

const ROLE_LABEL: Record<AdminRole, string> = {
  full: "Full administrator",
  bookings_only: "Begrenset (kun Bookinger)",
};

interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  createdAt: string;
}

export default function AccountSettings() {
  // --- Egen rolle (styrer om "Admin-brukere"-kortet under vises i det hele
  // tatt – en begrenset administrator skal verken se listen over andre
  // administratorer eller kunne opprette flere, se middleware.ts for den
  // faktiske håndhevingen av dette) ---
  const [ownRole, setOwnRole] = useState<AdminRole | null>(null);
  /** Egen bruker-id (session.sub, se /api/admin/me) - brukes til å skjule Rediger/Slett på egen rad under. */
  const [ownId, setOwnId] = useState<string | null>(null);

  // --- Admin-brukere ---
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newUserRole, setNewUserRole] = useState<AdminRole>("full");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserPasswordConfirm, setNewUserPasswordConfirm] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);
  const [createMessage, setCreateMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // --- Rediger/slett en EKSISTERENDE admin-bruker (aldri egen rad, se ownId) ---
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<AdminRole>("full");
  const [editPassword, setEditPassword] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editMessage, setEditMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function startEdit(u: AdminUserRow) {
    setEditingId(u.id);
    setEditName(u.name);
    setEditEmail(u.email);
    setEditRole(u.role);
    setEditPassword("");
    setEditMessage(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditMessage(null);
  }

  async function handleSaveEdit(e: FormEvent, id: string) {
    e.preventDefault();
    setSavingEdit(true);
    setEditMessage(null);
    try {
      const body: { name: string; email: string; role: AdminRole; password?: string } = {
        name: editName,
        email: editEmail,
        role: editRole,
      };
      if (editPassword.trim().length > 0) body.password = editPassword;

      const res = await fetch(`/api/admin/account/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };

      if (!res.ok) {
        setEditMessage({ ok: false, text: data.error ?? "Kunne ikke lagre." });
        return;
      }

      setEditingId(null);
      await loadUsers();
    } catch {
      setEditMessage({ ok: false, text: "Kunne ikke lagre akkurat nå." });
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteUser(u: AdminUserRow) {
    if (!window.confirm(`Slette admin-brukeren "${u.name}" (${u.email})? Dette kan ikke angres.`)) return;

    setDeletingId(u.id);
    try {
      const res = await fetch(`/api/admin/account/users/${u.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        window.alert(data.error ?? "Kunne ikke slette brukeren.");
        return;
      }
      await loadUsers();
    } finally {
      setDeletingId(null);
    }
  }

  async function loadUsers() {
    setLoadingUsers(true);
    try {
      const res = await fetch("/api/admin/account/users", { cache: "no-store" });
      const data = (await res.json()) as { users: AdminUserRow[] };
      setUsers(data.users ?? []);
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    fetch("/api/admin/me", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ id?: string; role?: AdminRole }>) : null))
      .then((data) => {
        const role = data?.role ?? "full";
        setOwnRole(role);
        setOwnId(data?.id ?? null);
        // En begrenset administrator har uansett ikke tilgang til
        // /api/admin/account/users (se middleware.ts), så det er ingen vits
        // i å prøve å laste listen for dem.
        if (role === "full") loadUsers();
        else setLoadingUsers(false);
      })
      .catch(() => {
        setOwnRole("full");
        loadUsers();
      });
  }, []);

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    setCreateMessage(null);

    if (newUserPassword !== newUserPasswordConfirm) {
      setCreateMessage({ ok: false, text: "De to passordene er ikke like." });
      return;
    }

    setCreatingUser(true);
    try {
      const res = await fetch("/api/admin/account/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail, name: newName, password: newUserPassword, role: newUserRole }),
      });
      const data = (await res.json()) as { error?: string };

      if (!res.ok) {
        setCreateMessage({ ok: false, text: data.error ?? "Kunne ikke opprette bruker." });
        return;
      }

      setNewEmail("");
      setNewName("");
      setNewUserRole("full");
      setNewUserPassword("");
      setNewUserPasswordConfirm("");
      setCreateMessage({ ok: true, text: "Ny admin-bruker opprettet." });
      await loadUsers();
    } catch {
      setCreateMessage({ ok: false, text: "Kunne ikke opprette bruker akkurat nå." });
    } finally {
      setCreatingUser(false);
    }
  }

  return (
    <>
      <AdminNav active="konto" />
      <main className={styles.page}>
        <div className={styles.tabPanel}>
          <h1 className={styles.title}>Administratorer</h1>
          <p className={styles.subtitle}>
            Gi flere personer tilgang til adminpanelet. Eget passord bytter du via navnet ditt øverst til høyre.
          </p>

      {ownRole === "full" && (
        <div className={styles.card}>
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Admin-brukere</h2>
          <p className={styles.bookingMeta}>
            "Full administrator" kan gjøre alt i adminpanelet (se bookinger, avlyse, blokkere tid, endre
            Vipps-innstillinger, og legge til flere brukere). "Begrenset (kun Bookinger)" kan kun se og administrere
            Bookinger-fanen (kalenderen, avtaler og blokkering av tid) samt bytte sitt eget passord her under Min
            konto – resten av adminpanelet er stengt for denne rollen. Vurder å ha minst to fulle administratorer,
            slik at dere ikke er avhengig av å huske ett eneste passord riktig for alltid.
          </p>

          {loadingUsers && <p>Laster …</p>}
          {!loadingUsers && (
            <div className={styles.userList}>
              {users.map((u) => (
                <div key={u.id} className={styles.userRow}>
                  {editingId === u.id ? (
                    <form onSubmit={(e) => handleSaveEdit(e, u.id)} className={styles.form} style={{ width: "100%" }}>
                      <div className={styles.formRow}>
                        <label htmlFor={`edit-name-${u.id}`}>Navn</label>
                        <input
                          id={`edit-name-${u.id}`}
                          type="text"
                          required
                          minLength={2}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                      </div>
                      <div className={styles.formRow}>
                        <label htmlFor={`edit-email-${u.id}`}>E-post</label>
                        <input
                          id={`edit-email-${u.id}`}
                          type="email"
                          required
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          autoComplete="off"
                        />
                      </div>
                      <div className={styles.formRow}>
                        <label htmlFor={`edit-role-${u.id}`}>Rolle</label>
                        <select
                          id={`edit-role-${u.id}`}
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value as AdminRole)}
                        >
                          <option value="full">Full administrator</option>
                          <option value="bookings_only">Begrenset (kun Bookinger)</option>
                        </select>
                      </div>
                      <div className={styles.formRow}>
                        <label htmlFor={`edit-password-${u.id}`}>Nytt passord (valgfritt)</label>
                        <input
                          id={`edit-password-${u.id}`}
                          type="password"
                          minLength={8}
                          value={editPassword}
                          onChange={(e) => setEditPassword(e.target.value)}
                          autoComplete="new-password"
                          placeholder="La stå tom for å ikke endre"
                        />
                      </div>

                      {editMessage && (
                        <p className={editMessage.ok ? styles.success : styles.error}>{editMessage.text}</p>
                      )}

                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="submit" className={styles.submitButton} disabled={savingEdit}>
                          {savingEdit ? "Lagrer …" : "Lagre"}
                        </button>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={cancelEdit}
                          disabled={savingEdit}
                        >
                          Avbryt
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div>
                        <strong>{u.name}</strong>
                        <div className={styles.bookingMeta}>{u.email}</div>
                      </div>
                      <div className={styles.bookingMeta}>
                        {ROLE_LABEL[u.role]} &middot; lagt til {formatOslo(u.createdAt, "d. MMM yyyy")}
                      </div>
                      {u.id !== ownId && (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button type="button" className={styles.secondaryButton} onClick={() => startEdit(u)}>
                            Rediger
                          </button>
                          <button
                            type="button"
                            className={styles.dangerButton}
                            disabled={deletingId === u.id}
                            onClick={() => handleDeleteUser(u)}
                          >
                            {deletingId === u.id ? "Sletter …" : "Slett"}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <h3 style={{ fontSize: "1rem" }}>Legg til ny admin-bruker</h3>
          <form onSubmit={handleCreateUser} className={styles.form}>
            <div className={styles.formRow}>
              <label htmlFor="new-user-name">Navn</label>
              <input id="new-user-name" type="text" required minLength={2} value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className={styles.formRow}>
              <label htmlFor="new-user-email">E-post (brukes som innloggingsnavn)</label>
              <input
                id="new-user-email"
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className={styles.formRow}>
              <label htmlFor="new-user-role">Rolle</label>
              <select
                id="new-user-role"
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as AdminRole)}
              >
                <option value="full">Full administrator</option>
                <option value="bookings_only">Begrenset (kun Bookinger)</option>
              </select>
            </div>
            <div className={styles.formRow}>
              <label htmlFor="new-user-password">Passord</label>
              <input
                id="new-user-password"
                type="password"
                required
                minLength={8}
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className={styles.formRow}>
              <label htmlFor="new-user-password-confirm">Gjenta passord</label>
              <input
                id="new-user-password-confirm"
                type="password"
                required
                minLength={8}
                value={newUserPasswordConfirm}
                onChange={(e) => setNewUserPasswordConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            {createMessage && <p className={createMessage.ok ? styles.success : styles.error}>{createMessage.text}</p>}

            <button type="submit" className={styles.submitButton} disabled={creatingUser}>
              {creatingUser ? "Oppretter …" : "Opprett admin-bruker"}
            </button>
          </form>
        </div>
      )}
        </div>
      </main>
    </>
  );
}
