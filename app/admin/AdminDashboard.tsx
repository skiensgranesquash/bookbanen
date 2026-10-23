"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./admin.module.css";
import { formatOslo, formatPriceOre } from "@/lib/formatting";
import BookingsInsights, { Leaderboard } from "./BookingsInsights";
import AdminNav from "./AdminNav";

export type Status = "pending" | "confirmed" | "cancelled" | "expired";
export type Kind = "single" | "recurring" | "block";
export type Source = "customer" | "admin";

export interface SlotInfo {
  startTime: string;
  endTime: string;
}

export interface BookingRow {
  id: string;
  status: Status;
  kind: Kind;
  source: Source;
  customerName: string;
  customerPhone: string;
  totalAmountOre: number;
  note: string | null;
  createdAt: string;
  slots: SlotInfo[];
}

function formatSlot(slot: SlotInfo): string {
  return formatOslo(slot.startTime, "EEEE d. MMM yyyy 'kl.' HH:mm");
}

/**
 * Merket som vises i "Siste bookinger" – forteller HVORDAN det gikk med
 * bookingen, ikke bare rå status. En bekreftet booking skiller mellom
 * "Betalt" (vanlig kunde, via bookingsiden) og "Manuelt" (admin opprettet
 * den direkte, f.eks. "Book uten betaling") – begge grønne, siden begge er
 * en vellykket, bindende booking. Kun tre farger brukes totalt: grønt
 * (vellykket), gult (venter), rødt (feilet/avlyst).
 */
function statusBadge(booking: BookingRow): { label: string; className: string } {
  if (booking.status === "pending") return { label: "Venter på betaling", className: "badgePending" };
  if (booking.status === "cancelled") return { label: "Avlyst", className: "badgeCancelled" };
  if (booking.status === "expired") return { label: "Utløpt", className: "badgeExpired" };
  // confirmed
  return booking.source === "admin"
    ? { label: "Manuelt", className: "badgeConfirmed" }
    : { label: "Betalt", className: "badgeConfirmed" };
}

export default function AdminDashboard() {
  const router = useRouter();

  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const loadBookings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/bookings", { cache: "no-store" });
      if (!res.ok) throw new Error("Kunne ikke hente bookinger.");
      const data = (await res.json()) as { bookings: BookingRow[] };
      setBookings(data.bookings);
    } catch {
      setError("Kunne ikke hente bookinger akkurat nå.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/admin/me")
      .then((res) => {
        if (!res.ok) {
          router.push("/admin/login");
          return null;
        }
        return res.json() as Promise<{ name: string; email: string }>;
      })
      .then((data) => {
        if (data) setUser(data);
      });

    loadBookings();
  }, [router, loadBookings]);

  async function handleCancel(id: string, label: string) {
    if (!window.confirm(`Avlyse "${label}"? Dette kan ikke angres.`)) return;

    setCancellingId(id);
    try {
      const res = await fetch(`/api/admin/bookings/${id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; warning?: string };
      if (!res.ok) {
        window.alert(data.error ?? "Kunne ikke avlyse bookingen.");
      } else if (data.warning) {
        window.alert(data.warning);
      }
      await loadBookings();
    } finally {
      setCancellingId(null);
    }
  }

  // "Siste bookinger" er en logg over faktiske bookingforsøk (kundens egne,
  // admin sine manuelle, OG mislykkede/avlyste) – IKKE blokkeringer av banen,
  // som har sin egen dedikerte visning i kalenderen over. API-et
  // (app/api/admin/bookings/route.ts) sorterer allerede etter når bookingen
  // ble OPPRETTET (nyest øverst), så det holder å filtrere bort "block" her.
  const visibleBookings = bookings.filter((b) => b.kind !== "block");

  return (
    <>
      <AdminNav active="oversikt" />
      <main className={styles.page}>
        <div className={styles.tabPanel}>
          <h1 className={styles.title}>Bookinger</h1>
          {user && <p className={styles.subtitle}>Innlogget som {user.name}</p>}

          {!loading && !error && (
            <BookingsInsights bookings={bookings} onChanged={loadBookings} onCancel={handleCancel} />
          )}

          <div className={styles.threeColRow}>
            <div className={styles.card}>
              <Leaderboard bookings={bookings} />
            </div>

            <div className={styles.card}>
              <div className={styles.filterRow}>
                <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Siste bookinger</h2>
                <button type="button" className={styles.secondaryButton} onClick={loadBookings}>
                  Oppdater
                </button>
              </div>
              <p className={styles.bookingMeta} style={{ marginTop: 4 }}>
                Alle bookingforsøk, nyeste øverst – også avlyste, utløpte og de admin har registrert manuelt.
              </p>

              {loading && <p>Laster …</p>}
              {error && <p className={styles.error}>{error}</p>}

              {!loading && visibleBookings.length === 0 && <p>Ingen bookinger å vise.</p>}

              <div className={styles.bookingList}>
                {visibleBookings.map((booking) => {
                  const label = `${booking.customerName} – ${booking.slots.length > 1 ? `${booking.slots.length} økter` : formatSlot(booking.slots[0])}`;
                  const badge = statusBadge(booking);

                  return (
                    <div key={booking.id} className={styles.bookingRow}>
                      <div>
                        <strong>{booking.customerName}</strong>
                        <span className={`${styles.badge} ${styles[badge.className]}`}>{badge.label}</span>
                        {booking.kind === "recurring" && (
                          <span className={`${styles.badge} ${styles.badgeBlock}`}>Gjentakende ({booking.slots.length})</span>
                        )}

                        <div className={styles.bookingMeta}>
                          {booking.customerPhone} &middot; {formatPriceOre(booking.totalAmountOre)} &middot; booket{" "}
                          {formatOslo(booking.createdAt, "d. MMM yyyy 'kl.' HH:mm")}
                        </div>

                        <div className={styles.slotDates}>
                          {booking.slots.map((s) => (
                            <div key={s.startTime}>{formatSlot(s)}</div>
                          ))}
                        </div>
                      </div>

                      {(booking.status === "pending" || booking.status === "confirmed") && (
                        <button
                          type="button"
                          className={styles.dangerButton}
                          disabled={cancellingId === booking.id}
                          onClick={() => handleCancel(booking.id, label)}
                        >
                          {cancellingId === booking.id ? "Avlyser …" : "Avlys"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
