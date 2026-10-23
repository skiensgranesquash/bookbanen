import Link from "next/link";
import type { Metadata } from "next";
import BookingCalendar from "./BookingCalendar";
import styles from "./booking.module.css";
import { PRICE_PER_HOUR_ORE, VENUE_NAME } from "@/lib/config";
import { getBranding } from "@/lib/settings/branding";

export async function generateMetadata(): Promise<Metadata> {
  const { clubName } = await getBranding();
  return {
    title: `Book squashbanen | ${clubName}`,
    description: `Book og betal for squashbanen på ${VENUE_NAME} med Vipps.`,
  };
}

/**
 * Serverkomponent som setter opp selve sidekroken. Ment å limes inn i
 * skiensgrane.no under /squash/booking – bytt gjerne ut <header>/<footer>
 * her med klubbens faktiske delte layout-komponenter når dette flyttes inn
 * i hovedprosjektet, slik at meny/footer blir identisk med resten av siden.
 *
 * Klubbnavn og logo hentes fra lib/settings/branding.ts (satt i adminpanelet
 * under "Utseende") i stedet for å være hardkodet – default er den
 * medfølgende public/logo-squash.jpg og "IF Skiens Grane" helt til noen
 * faktisk laster opp sin egen logo/navn, slik at siden er lett å gjenbruke
 * for en annen klubb/bedrift.
 */
export default async function SquashBookingPage() {
  const branding = await getBranding();

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
            {branding.clubName} &middot; {VENUE_NAME} &middot; 1 time per booking, start hver hele og halve time
            &middot; {(PRICE_PER_HOUR_ORE / 100).toLocaleString("nb-NO")} kr/time, betales med Vipps
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/admin" className={styles.secondaryButton}>
            Adminpanel
          </Link>
        </div>
      </div>

      <BookingCalendar />
    </main>
  );
}
