"use client";

import styles from "../admin.module.css";

const SUB_TABS = [
  { key: "turneringer", label: "Turneringer", href: "/admin/koder/turneringer" },
  { key: "klippekort", label: "Klippekort", href: "/admin/koder/klippekort" },
] as const;

export type KoderTabKey = (typeof SUB_TABS)[number]["key"];

/**
 * Underfane-linje for "Koder" (se TABS i AdminNav.tsx) – Turneringer og
 * Klippekort er to separate sider/komponenter, men vises som to faner under
 * samme hovedfane i venstremenyen. Rendres av hver underside selv (se
 * turneringer/TournamentsManager.tsx og klippekort/KlippekortManager.tsx),
 * rett over sidens egen <h1>.
 */
export default function KoderTabs({ active }: { active: KoderTabKey }) {
  return (
    <div className={styles.subTabBar}>
      {SUB_TABS.map((tab) => (
        <a
          key={tab.key}
          href={tab.href}
          className={`${styles.subTabLink} ${tab.key === active ? styles.subTabLinkActive : ""}`}
          aria-current={tab.key === active ? "page" : undefined}
        >
          {tab.label}
        </a>
      ))}
    </div>
  );
}
