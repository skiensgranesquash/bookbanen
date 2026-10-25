"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./admin.module.css";

const TABS = [
  { key: "oversikt", label: "Bookinger", href: "/admin" },
  { key: "konto", label: "Min konto", href: "/admin/account" },
  { key: "vipps", label: "Innstillinger (Vipps)", href: "/admin/settings" },
  { key: "apningstider", label: "Åpningstider", href: "/admin/opening-hours" },
  { key: "utseende", label: "Utseende", href: "/admin/branding" },
] as const;

/** Fanene en begrenset ("bookings_only") administrator får se – resten finnes fortsatt (og er uansett stengt av middleware.ts om noen taster inn adressen direkte), men vises ikke her. */
const BOOKINGS_ONLY_VISIBLE_TABS = new Set(["oversikt", "konto"]);

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
 *
 * Henter sin egen rolle via /api/admin/me (i stedet for at hver side som
 * bruker <AdminNav> må sende den inn) – en "bookings_only"-administrator
 * (begrenset admin, se lib/db/types.ts) ser da kun "Bookinger" og
 * "Min konto" her. Selve håndhevingen av hva en slik bruker faktisk FÅR
 * gjøre skjer uansett i middleware.ts, uavhengig av hva som vises i menyen –
 * dette er bare for å ikke vise lenker til sider de ikke har tilgang til.
 */
export default function AdminNav({ active }: { active: AdminNavKey }) {
  const router = useRouter();
  const [bookingsOnly, setBookingsOnly] = useState(false);

  useEffect(() => {
    fetch("/api/admin/me", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ role?: string }>) : null))
      .then((data) => {
        if (data?.role === "bookings_only") setBookingsOnly(true);
      })
      .catch(() => {
        // Ikke kritisk – i verste fall vises alle fanene til en begrenset
        // admin kortvarig; middleware.ts stenger fortsatt det hun/han ikke
        // har tilgang til om en slik fane faktisk klikkes på.
      });
  }, []);

  const visibleTabs = bookingsOnly ? TABS.filter((tab) => BOOKINGS_ONLY_VISIBLE_TABS.has(tab.key)) : TABS;

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <div className={styles.navBar}>
      <div className={styles.navBarInner}>
        <div className={styles.navTabs}>
          {visibleTabs.map((tab) => (
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
