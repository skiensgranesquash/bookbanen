"use client";

import styles from "../../admin.module.css";
import AdminNav from "../../AdminNav";
import KoderTabs from "../KoderTabs";

/**
 * "Klippekort" – underfane under Koder (se app/admin/koder/KoderTabs.tsx).
 * Foreløpig en plassholder: selve kjøpsflyten (kunden velger antall kamper,
 * betaler med Vipps, får en kode generert av ordkombinasjoner, sendt på
 * e-post) bygges i en EGEN runde, siden den trenger en ny kjøpsside, en
 * kodegenerator og e-postutsending (e-posttjeneste ikke valgt ennå – avtales
 * i chatten med Helge). Denne siden finnes likevel allerede nå, slik at
 * "Koder"-fanen har begge underfanene synlige på plass.
 */
export default function KlippekortManager() {
  return (
    <>
      <AdminNav active="koder" />
      <main className={styles.page}>
        <div className={styles.tabPanel}>
          <KoderTabs active="klippekort" />
          <h1 className={styles.title}>Klippekort</h1>
          <p className={styles.subtitle}>
            Kunder skal kunne kjøpe et valgfritt antall kamper til en fast pris per kamp, og få en kode (bygget av
            ordkombinasjoner) de kan bruke selv eller gi bort – delt opp i en egen runde siden den trenger en egen
            kjøpsside med Vipps og e-postutsending.
          </p>
          <div className={styles.card}>
            <p className={styles.bookingMeta}>Kommer snart – under utvikling.</p>
          </div>
        </div>
      </main>
    </>
  );
}
