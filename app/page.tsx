import Link from "next/link";
import type { Metadata } from "next";
import BookingCalendar from "./BookingCalendar";
import styles from "./booking.module.css";
import { VENUE_NAME } from "@/lib/config";
import { getBranding } from "@/lib/settings/branding";
import { getPricingSettings } from "@/lib/settings/pricing";
import { getRecurringCutoffDate } from "@/lib/settings/recurringLimit";

// Uten denne blir siden statisk forhåndsrenderet ved BUILD-tidspunktet (Next.js
// ser ingen "dynamisk" API-bruk her, bare rene databaseoppslag) – da fryses
// branding/priser/grense for gjentakende bookinger til akkurat de verdiene de
// hadde DA man sist kjørte "npm run build", og endringer i adminpanelet
// (f.eks. en ny grensedato) vises ikke på selve bookingsiden før NESTE
// deploy, selv om API-rutene (som alle har denne samme linjen) uansett
// håndhever den ferske verdien korrekt. Se feilen dette forårsaket: "antall
// uker"-feltet ble aldri begrenset av en nylig satt grensedato, siden
// `recurringCutoffDate` kom fra den gamle, cachede siden.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { clubName } = await getBranding();
  return {
    title: `Book squashbanen | ${clubName}`,
    description: `Book og betal for squashbanen på ${VENUE_NAME} med Vipps.`,
  };
}

/**
 * Selve forsiden på bookbanen.no – appen er en egen, selvstendig
 * produksjonsside (ikke en del av skiensgrane.no), så bookingsiden ligger
 * direkte på "/" i stedet for bak en "/squash/booking"-sti.
 *
 * Klubbnavn og logo hentes fra lib/settings/branding.ts (satt i adminpanelet
 * under "Utseende") i stedet for å være hardkodet – default er den
 * medfølgende public/logo-squash.jpg og "IF Skiens Grane" helt til noen
 * faktisk laster opp sin egen logo/navn, slik at siden er lett å gjenbruke
 * for en annen klubb/bedrift.
 */
export default async function SquashBookingPage() {
  const [branding, recurringCutoffDate, pricing] = await Promise.all([
    getBranding(),
    getRecurringCutoffDate(),
    getPricingSettings(),
  ]);

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <img
          src={branding.logoDataUrl ?? "/logo-squash.jpg"}
          alt={branding.clubName}
          className={styles.logo}
          width={96}
          height={96}
        />
        <div>
          <h1 className={styles.title}>Book squashbanen</h1>
          <p className={styles.subtitle}>
            {branding.clubName} &middot; {VENUE_NAME} &middot; Book 30 minutter eller 1 time &middot; fra{" "}
            {(pricing.price30MinOre / 100).toLocaleString("nb-NO")} kr, betales med Vipps
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/admin" className={styles.secondaryButton}>
            Adminpanel
          </Link>
        </div>
      </div>

      <p className={styles.membershipNotice}>
        For å booke bane må du ha tilgang til banen gjennom medlemskap i Skiens Grane Squash eller Mova Skien. Du
        bekrefter dette før du går videre til betaling.
      </p>

      <BookingCalendar
        recurringCutoffDate={recurringCutoffDate}
        price30MinOre={pricing.price30MinOre}
        price60MinOre={pricing.price60MinOre}
      />
    </main>
  );
}
