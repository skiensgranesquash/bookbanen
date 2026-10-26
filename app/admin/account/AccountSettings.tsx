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
      .then((res) => (res.ok ? (res.json() as Promise<{ role?: AdminRole }>) : null))
      .then((data) => {
        const role = data?.role ?? "full";
        setOwnRole(role);
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
                  <div>
                    <strong>{u.name}</strong>
                    <div className={styles.bookingMeta}>{u.email}</div>
                  </div>
                  <div className={styles.bookingMeta}>
                    {ROLE_LABEL[u.role]} &middot; lagt til {formatOslo(u.createdAt, "d. MMM yyyy")}
                  </div>
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
