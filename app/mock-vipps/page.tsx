import { Suspense } from "react";
import MockVippsCheckout from "./MockVippsCheckout";
import styles from "../booking.module.css";

export const metadata = {
  title: "Vipps (simulert) | Lokal testing",
};

export default function MockVippsPage() {
  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Simulert Vipps-betaling</h1>
          <p className={styles.subtitle}>
            Dette er en lokal simulering (PAYMENT_PROVIDER=mock) – ingen ekte penger eller Vipps-konto er involvert.
          </p>
        </div>
      </div>

      <Suspense fallback={<div className={styles.card}>Laster …</div>}>
        <MockVippsCheckout />
      </Suspense>
    </main>
  );
}
