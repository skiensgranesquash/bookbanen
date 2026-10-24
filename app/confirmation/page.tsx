import { Suspense } from "react";
import ConfirmationStatus from "./ConfirmationStatus";
import styles from "../booking.module.css";

export const metadata = {
  title: "Bookingbekreftelse | IF Skiens Grane",
};

export default function ConfirmationPage() {
  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <img src="/logo-squash.jpg" alt="IF Skiens Grane Squash" className={styles.logo} width={96} height={96} />
        <div>
          <h1 className={styles.title}>Booking av squashbane</h1>
        </div>
      </div>

      {/* useSearchParams() i ConfirmationStatus krever en Suspense-grense
          for at Next.js skal kunne bygge siden statisk. */}
      <Suspense fallback={<div className={styles.card}>Laster …</div>}>
        <ConfirmationStatus />
      </Suspense>
    </main>
  );
}
