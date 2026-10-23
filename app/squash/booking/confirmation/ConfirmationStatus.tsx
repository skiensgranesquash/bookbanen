"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import styles from "../booking.module.css";
import { formatOslo, formatPriceOre } from "@/lib/formatting";

type Status = "loading" | "pending" | "confirmed" | "cancelled" | "expired" | "not_found" | "error";

interface SlotInfo {
  startTime: string;
  endTime: string;
}

interface StatusResponse {
  status?: "pending" | "confirmed" | "cancelled" | "expired";
  kind?: "single" | "recurring" | "block";
  totalAmountOre?: number;
  slots?: SlotInfo[];
  error?: string;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60_000;

export default function ConfirmationStatus() {
  const searchParams = useSearchParams();
  const reference = searchParams.get("ref");

  const [status, setStatus] = useState<Status>("loading");
  const [kind, setKind] = useState<"single" | "recurring" | "block">("single");
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [totalAmountOre, setTotalAmountOre] = useState(0);
  const startedAtRef = useRef(Date.now());

  useEffect(() => {
    if (!reference) {
      setStatus("not_found");
      return;
    }

    let cancelled = false;
    startedAtRef.current = Date.now();

    async function poll() {
      try {
        const res = await fetch(`/api/squash/bookings/${reference}`, { cache: "no-store" });
        const data = (await res.json()) as StatusResponse;

        if (cancelled) return;

        if (!res.ok || !data.status) {
          setStatus("not_found");
          return;
        }

        setStatus(data.status);
        if (data.kind) setKind(data.kind);
        if (data.slots) setSlots(data.slots);
        if (typeof data.totalAmountOre === "number") setTotalAmountOre(data.totalAmountOre);

        if (data.status === "pending" && Date.now() - startedAtRef.current < POLL_TIMEOUT_MS) {
          setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [reference]);

  return (
    <div className={`${styles.card} ${styles.status}`}>
      {status === "loading" && (
        <>
          <div className={styles.statusIcon}>⏳</div>
          <p>Henter status …</p>
        </>
      )}

      {status === "pending" && (
        <>
          <div className={styles.statusIcon}>⏳</div>
          <p>Venter på bekreftelse fra Vipps …</p>
          <p className={styles.subtitleText}>Dette tar vanligvis bare noen sekunder. Ikke lukk siden.</p>
        </>
      )}

      {status === "confirmed" && (
        <>
          <div className={styles.statusIcon}>✅</div>
          <p>
            <strong>{kind === "recurring" ? `Banen er booket (${slots.length} økter)!` : "Banen er booket!"}</strong>
          </p>
          <ul style={{ textAlign: "left", display: "inline-block", margin: "8px 0" }}>
            {slots.map((s) => (
              <li key={s.startTime}>{formatOslo(s.startTime, "EEEE d. MMM 'kl.' HH:mm")}</li>
            ))}
          </ul>
          {totalAmountOre > 0 && <p className={styles.subtitleText}>Betalt: {formatPriceOre(totalAmountOre)}</p>}
        </>
      )}

      {(status === "cancelled" || status === "expired") && (
        <>
          <div className={styles.statusIcon}>❌</div>
          <p>Betalingen ble ikke gjennomført, så tiden(e) er ikke booket.</p>
          <p>Du kan gå tilbake og prøve på nytt.</p>
        </>
      )}

      {status === "not_found" && (
        <>
          <div className={styles.statusIcon}>❓</div>
          <p>Fant ingen booking å vise. Sjekk lenken, eller gå tilbake og prøv igjen.</p>
        </>
      )}

      {status === "error" && (
        <>
          <div className={styles.statusIcon}>⚠️</div>
          <p>Klarte ikke å hente status akkurat nå. Prøv å laste siden på nytt.</p>
        </>
      )}

      {status !== "loading" && status !== "pending" && (
        <div className={styles.statusActions}>
          <a href="/squash/booking" className={styles.secondaryButton}>
            {status === "confirmed" ? "Book en ny time" : "Tilbake til booking"}
          </a>
        </div>
      )}
    </div>
  );
}
