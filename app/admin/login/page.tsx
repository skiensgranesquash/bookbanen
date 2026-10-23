import { Suspense } from "react";
import LoginForm from "./LoginForm";
import styles from "../admin.module.css";

export const metadata = { title: "Logg inn – Adminpanel" };

export default function AdminLoginPage() {
  return (
    <main className={styles.page}>
      <div className={styles.loginCard}>
        <h1 className={styles.title}>Logg inn</h1>
        <p className={styles.subtitle}>Adminpanel for squashbane-booking</p>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
