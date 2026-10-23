"use client";

import { useEffect, useState, type FormEvent } from "react";
import styles from "../admin.module.css";
import { formatOslo } from "@/lib/formatting";
import AdminNav from "../AdminNav";

interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export default function AccountSettings() {
  // --- Bytt passord ---
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // --- Admin-brukere ---
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserPasswordConfirm, setNewUserPasswordConfirm] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);
  const [createMessage, setCreateMessage] = useState<{ ok: boolean; text: string } | null>(null);

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
    loadUsers();
  }, []);

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordMessage(null);

    if (newPassword !== confirmPassword) {
      setPasswordMessage({ ok: false, text: "De to nye passordene er ikke like." });
      return;
    }

    setChangingPassword(true);
    try {
      const res = await fetch("/api/admin/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await res.json()) as { error?: string };

      if (!res.ok) {
        setPasswordMessage({ ok: false, text: data.error ?? "Kunne ikke bytte passord." });
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage({ ok: true, text: "Passordet er byttet." });
    } catch {
      setPasswordMessage({ ok: false, text: "Kunne ikke bytte passord akkurat nå." });
    } finally {
      setChangingPassword(false);
    }
  }

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
        body: JSON.stringify({ email: newEmail, name: newName, password: newUserPassword }),
      });
      const data = (await res.json()) as { error?: string };

      if (!res.ok) {
        setCreateMessage({ ok: false, text: data.error ?? "Kunne ikke opprette bruker." });
        return;
      }

      setNewEmail("");
      setNewName("");
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
          <h1 className={styles.title}>Min konto</h1>
          <p className={styles.subtitle}>Bytt eget passord, eller gi flere personer tilgang til adminpanelet.</p>

      <div className={styles.card}>
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Bytt passord</h2>
        <form onSubmit={handleChangePassword} className={styles.form}>
          <div className={styles.formRow}>
            <label htmlFor="current-password">Nåværende passord</label>
            <input
              id="current-password"
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className={styles.formRow}>
            <label htmlFor="new-password">Nytt passord</label>
            <input
              id="new-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className={styles.formRow}>
            <label htmlFor="confirm-password">Gjenta nytt passord</label>
            <input
              id="confirm-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          {passwordMessage && (
            <p className={passwordMessage.ok ? styles.success : styles.error}>{passwordMessage.text}</p>
          )}

          <button type="submit" className={styles.submitButton} disabled={changingPassword}>
            {changingPassword ? "Bytter …" : "Bytt passord"}
          </button>
        </form>
      </div>

      <div className={styles.card}>
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Admin-brukere</h2>
        <p className={styles.bookingMeta}>
          Alle som er listet her kan logge inn og gjøre alt i adminpanelet (se bookinger, avlyse, blokkere tid,
          endre Vipps-innstillinger, og legge til flere brukere). Vurder å ha minst to, slik at dere ikke er
          avhengig av å huske ett eneste passord riktig for alltid.
        </p>

        {loadingUsers && <p>Laster …</p>}
        {!loadingUsers && (
          <div className={styles.userList}>
            {users.map((u) => (
              <div key={u.id} className={styles.userRow}>
                <div>
                  <strong>{u.name}</strong>
                  <div className={styles.bookingMeta}>{u.email}</div>
                </div>
                <div className={styles.bookingMeta}>Lagt til {formatOslo(u.createdAt, "d. MMM yyyy")}</div>
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
        </div>
      </main>
    </>
  );
}
