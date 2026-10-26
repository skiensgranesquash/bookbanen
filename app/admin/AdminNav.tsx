"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "./admin.module.css";

const TABS = [
  { key: "oversikt", label: "Bookinger", href: "/admin" },
  { key: "konto", label: "Administratorer", href: "/admin/account" },
  { key: "vipps", label: "Vipps", href: "/admin/settings" },
  { key: "apningstider", label: "Oppsett", href: "/admin/opening-hours" },
  { key: "utseende", label: "Utseende", href: "/admin/branding" },
] as const;

/**
 * Sidene en begrenset ("bookings_only") administrator får se her – resten
 * finnes fortsatt (og er uansett stengt av middleware.ts om noen taster inn
 * adressen direkte), men vises ikke i menyen. Siden eget passord nå byttes
 * fra profilmerket i toppbaren (se ProfileMenu under) i stedet for en egen
 * side, trenger en begrenset administrator ikke lenger "Administratorer"
 * synlig her – den siden handler nå kun om å administrere ANDRE
 * administratorer, noe bare en full administrator kan (håndhevet i
 * middleware.ts, uavhengig av hva som vises her).
 */
const BOOKINGS_ONLY_VISIBLE_TABS = new Set(["oversikt"]);

export type AdminNavKey = (typeof TABS)[number]["key"];

interface Me {
  name: string;
  email: string;
  role?: string;
}

/**
 * Fast venstremeny + toppbar, delt av alle innloggede admin-sider
 * (app/admin/**). Sidemenyen til venstre viser de bookbare SIDENE
 * (Bookinger, Administratorer, Vipps, Oppsett, Utseende) – alt som handler
 * om BRUKEREN selv (bytte passord, logge ut) ligger i stedet bak
 * profilmerket i toppbaren til høyre, uavhengig av hvilken side man står på,
 * se ProfileMenu under.
 *
 * `active` sendes inn av hver side (se f.eks. AdminDashboard.tsx) – bevisst
 * ingen automatikk basert på URL, siden den uansett må stemme overens med
 * hvilket innhold siden faktisk rendrer under.
 *
 * Henter sin egen rolle (og navn/e-post, til profilmerket) via
 * /api/admin/me – en "bookings_only"-administrator (begrenset admin, se
 * lib/db/types.ts) ser da kun "Bookinger" her. Selve håndhevingen av hva en
 * slik bruker faktisk FÅR gjøre skjer uansett i middleware.ts, uavhengig av
 * hva som vises i menyen – dette er bare for å ikke vise lenker til sider de
 * ikke har tilgang til.
 */
export default function AdminNav({ active }: { active: AdminNavKey }) {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch("/api/admin/me", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<Me>) : null))
      .then((data) => {
        if (data) setMe(data);
      })
      .catch(() => {
        // Ikke kritisk – i verste fall vises alle menypunktene kortvarig for
        // en begrenset admin; middleware.ts stenger fortsatt det hun/han
        // ikke har tilgang til om et slikt menypunkt faktisk klikkes på.
      });
  }, []);

  const bookingsOnly = me?.role === "bookings_only";
  const visibleTabs = bookingsOnly ? TABS.filter((tab) => BOOKINGS_ONLY_VISIBLE_TABS.has(tab.key)) : TABS;

  return (
    <>
      <div className={styles.sidebar}>
        <div className={styles.sidebarBrand}>Adminpanel</div>
        <nav className={styles.sidebarNav}>
          {visibleTabs.map((tab) => (
            <a
              key={tab.key}
              href={tab.href}
              className={`${styles.navLink} ${tab.key === active ? styles.navLinkActive : ""}`}
              aria-current={tab.key === active ? "page" : undefined}
            >
              {tab.label}
            </a>
          ))}
        </nav>
      </div>

      <div className={styles.topBar}>
        <a href="/" className={styles.secondaryButton}>
          Til bookingsiden
        </a>
        <ProfileMenu me={me} />
      </div>
    </>
  );
}

/**
 * Profilmerke øverst til høyre – viser innlogget admins navn, og samler ALT
 * som handler om EGEN konto (bytte passord, logge ut) bak ett klikk, i
 * stedet for at det ligger spredt som egne sider/knapper rundt om i
 * adminpanelet.
 */
function ProfileMenu({ me }: { me: Me | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Lukk dropdownen ved klikk utenfor den, eller ved Escape.
  useEffect(() => {
    if (!open) return;

    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

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

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <div className={styles.profileMenu} ref={containerRef}>
      <button type="button" className={styles.profileButton} onClick={() => setOpen((o) => !o)}>
        {me?.name ?? "Konto"} ▾
      </button>

      {open && (
        <div className={styles.profileDropdown}>
          <div className={styles.profileDropdownName}>{me?.name}</div>
          <div className={styles.profileDropdownEmail}>{me?.email}</div>

          <hr className={styles.profileDropdownDivider} />

          <form onSubmit={handleChangePassword} className={styles.form}>
            <div className={styles.formRow}>
              <label htmlFor="profile-current-password">Nåværende passord</label>
              <input
                id="profile-current-password"
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className={styles.formRow}>
              <label htmlFor="profile-new-password">Nytt passord</label>
              <input
                id="profile-new-password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className={styles.formRow}>
              <label htmlFor="profile-confirm-password">Gjenta nytt passord</label>
              <input
                id="profile-confirm-password"
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

          <hr className={styles.profileDropdownDivider} />

          <button type="button" className={styles.profileLogoutButton} onClick={handleLogout}>
            Logg ut
          </button>
        </div>
      )}
    </div>
  );
}
