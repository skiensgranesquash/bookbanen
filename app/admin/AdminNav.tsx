"use client";

import { useRouter } from "next/navigation";
import styles from "./admin.module.css";

const TABS = [
  { key: "oversikt", label: "Bookinger", href: "/admin" },
  { key: "konto", label: "Min konto", href: "/admin/account" },
  { key: "vipps", label: "Innstillinger (Vipps)", href: "/admin/settings" },
  { key: "apningstider", label: "Åpningstider", href: "/admin/opening-hours" },
  { key: "utseende", label: "Utseende", href: "/admin/branding" },
] as const;

export type AdminNavKey = (typeof TABS)[number]["key"];

/**
 * Fast toppmeny, delt av alle innloggede admin-sider (app/admin/**). Vises som
 * faner à la ark i et regneark – fanen for siden du står på løftes fram i
 * hvitt og henger visuelt sammen med rammen (.tabPanel) rundt selve
 * sideinnholdet på hver side, slik at det alltid er tydelig hvilket
 * menypunkt som er åpent.
 *
 * `active` sendes inn av hver side (se f.eks. AdminDashboard.tsx) – bevisst
 * ingen automatikk basert på URL, siden den uansett må stemme overens med
 * hvilket innhold siden faktisk rendrer under.
 */
export default function AdminNav({ active }: { active: AdminNavKey }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <div className={styles.navBar}>
      <div className={styles.navBarInner}>
        <div className={styles.navTabs}>
          {TABS.map((tab) => (
            <a
              key={tab.key}
              href={tab.href}
              className={`${styles.navTab} ${tab.key === active ? styles.navTabActive : ""}`}
              aria-current={tab.key === active ? "page" : undefined}
            >
              {tab.label}
            </a>
          ))}
        </div>
        <div className={styles.navActions}>
          <a href="/" className={styles.secondaryButton}>
            Til bookingsiden
          </a>
          <button type="button" className={styles.secondaryButton} onClick={handleLogout}>
            Logg ut
          </button>
        </div>
      </div>
    </div>
  );
}
