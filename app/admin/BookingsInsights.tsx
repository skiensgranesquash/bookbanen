"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameDay,
  isSameMonth,
  isWithinInterval,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { nb } from "date-fns/locale";
import styles from "./admin.module.css";
import { formatOslo } from "@/lib/formatting";
import { SLOT_LENGTH_MINUTES } from "@/lib/config";
import { todayInClubTimeZone } from "@/lib/slots";
import { useSlotMerging, type SlotVisualState } from "@/lib/useSlotMerging";
import type { BookingRow } from "./AdminDashboard";

const CAL_WEEKDAY_HEADERS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];

/** Maks antall enkeltbookinger som vises direkte i en dag-rute før resten samles i "+N mer" – holder rutene i kalenderen i fast størrelse uansett hvor mange bookinger en dag har. */
const MAX_VISIBLE_PER_DAY = 3;

/** Tolker en "YYYY-MM-DD"-streng som en lokal (nettleser-tidssone) dato – kun brukt til kalender-navigasjon/sammenligning, aldri til faktiske tidspunkt. */
function parseDateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

interface AvailabilitySlot {
  startTime: string;
  endTime: string;
  label: string;
  available: boolean;
  /** Kun satt når available er false. Se app/api/squash/availability/route.ts. */
  reason?: "booked" | "adjacent";
}

/**
 * Finner indeksen til rutenett-slotten som utgjør den ANDRE halvtimen av en
 * hel økt som starter ved `slots[i]` – samme logikk (og samme begrunnelse for
 * å lete via faktisk klokkeslett, ikke array-indeks + 1) som i
 * BookingCalendar.tsx på den offentlige bookingsiden.
 */
function secondHalfIndex(slots: AvailabilitySlot[], i: number): number {
  if (i < 0 || i >= slots.length) return -1;
  const target = new Date(slots[i].startTime).getTime() + SLOT_LENGTH_MINUTES * 60_000;
  return slots.findIndex((s) => new Date(s.startTime).getTime() === target);
}

interface Occurrence {
  /** Id-en til BookingRow-gruppen denne forekomsten hører til – brukt til å avlyse/redigere riktig booking. */
  id: string;
  dateStr: string;
  timeLabel: string;
  label: string;
  /** "Mislyktes" – avlyst eller utløpt (betaling fullført aldri, eller admin avlyste en ekte booking). Vises rødt og har alltid prioritet på å være synlig i dag-ruten, foran bekreftede/ventende. */
  failed: boolean;
  /** Kort tekst for dag-rutens trange plass: kundens navn, eller admin sin notat for en blokkering. */
  shortText: string;
  statusClass: string;
  status: BookingRow["status"];
  kind: BookingRow["kind"];
  customerName: string;
  customerPhone: string;
}

/** Flater ut alle bookinger til én rad PER faktisk tidsrom (en gjentakende booking har ett tidsrom per uke) – dette er enheten "en booking" regnes i overalt her, både i kalenderen og i statistikken/listen under. */
function flattenOccurrences(bookings: BookingRow[], includeStatuses: BookingRow["status"][]): Occurrence[] {
  const result: Occurrence[] = [];
  for (const booking of bookings) {
    if (!includeStatuses.includes(booking.status)) continue;
    for (const slot of booking.slots) {
      const dateStr = formatOslo(slot.startTime, "yyyy-MM-dd");
      const timeLabel = formatOslo(slot.startTime, "HH:mm");
      const failed = booking.status === "cancelled" || booking.status === "expired";
      const shortText = booking.kind === "block" ? booking.note ?? "Blokkert" : booking.customerName;
      const label =
        booking.kind === "block" ? `🔧 ${shortText} kl. ${timeLabel}` : `${booking.customerName} kl. ${timeLabel}`;
      const statusClass = failed
        ? styles.bcEventLineFailed
        : booking.kind === "block"
          ? styles.bcEventLineBlock
          : booking.status === "pending"
            ? styles.bcEventLinePending
            : "";

      result.push({
        id: booking.id,
        dateStr,
        timeLabel,
        label,
        failed,
        shortText,
        statusClass,
        status: booking.status,
        kind: booking.kind,
        customerName: booking.customerName,
        customerPhone: booking.customerPhone,
      });
    }
  }
  return result;
}

/** Hvilken CSS-klasse én enkelt oppføring i dag-ruten skal ha. Mislyktes (avlyst/utløpt) vinner alltid visuelt (rødt, gjennomstreket) – det er det viktigste å legge merke til. */
function entryClassFor(occ: Occurrence): string {
  if (occ.failed) return styles.bcEntryFailed;
  if (occ.kind === "block") return styles.bcEntryBlock;
  if (occ.status === "pending") return styles.bcEntryPending;
  return styles.bcEntryConfirmed;
}

/**
 * Velger hvilke av dagens oppføringer som faktisk vises i dag-ruten (maks
 * MAX_VISIBLE_PER_DAY, slik at ruten holder seg i fast størrelse). Mislykkede
 * bookinger (avlyst/utløpt) prioriteres ALLTID foran bekreftede/ventende –
 * det er viktigere å se at noe gikk galt enn å se én ekstra vellykket økt.
 * Resten samles i et "+N mer"-tall; klikk på dagen viser den fulle,
 * ikke-avkortede listen i agenda-panelet ved siden av.
 */
function pickVisibleForDay(dayOccurrences: Occurrence[]): { visible: Occurrence[]; hiddenCount: number } {
  const sorted = [...dayOccurrences].sort((a, b) => a.timeLabel.localeCompare(b.timeLabel));
  const failed = sorted.filter((o) => o.failed);
  const rest = sorted.filter((o) => !o.failed);

  const chosen: Occurrence[] = [...failed.slice(0, MAX_VISIBLE_PER_DAY)];
  for (const occ of rest) {
    if (chosen.length >= MAX_VISIBLE_PER_DAY) break;
    chosen.push(occ);
  }
  chosen.sort((a, b) => a.timeLabel.localeCompare(b.timeLabel));

  return { visible: chosen, hiddenCount: sorted.length - chosen.length };
}

function useConfirmedCustomerOccurrences(bookings: BookingRow[]): Occurrence[] {
  return useMemo(
    () => flattenOccurrences(bookings.filter((b) => b.kind !== "block"), ["confirmed"]),
    [bookings]
  );
}

const STATUS_LABEL_NB: Record<BookingRow["status"], string> = {
  pending: "venter på betaling",
  confirmed: "bekreftet",
  cancelled: "avlyst",
  expired: "utløpt",
};

type ModalState =
  | { mode: "create"; date: string }
  | {
      mode: "edit";
      id: string;
      date: string;
      kind: BookingRow["kind"];
      label: string;
      /** Brukt til å vise riktig tekst/knapp i modalen, og til å be API-et aktivere bookingen på nytt hvis den er avlyst. */
      status: BookingRow["status"];
    };

interface BookingsInsightsProps {
  bookings: BookingRow[];
  /** Kalles etter at admin har booket, redigert eller avlyst en tid fra kalenderen/agenda-panelet, slik at AdminDashboard kan laste inn bookinger på nytt. */
  onChanged: () => void;
  /** Avlyser en booking (samme funksjon som brukes i bookinglisten nederst – viser bekreftelsesdialog og refunderer ved behov). */
  onCancel: (id: string, label: string) => Promise<void>;
}

export default function BookingsInsights({ bookings, onChanged, onCancel }: BookingsInsightsProps) {
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => todayInClubTimeZone());

  const [modal, setModal] = useState<ModalState | null>(null);
  const [manualTime, setManualTime] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const [modalSlots, setModalSlots] = useState<AvailabilitySlot[] | null>(null);
  const [modalSlotsLoading, setModalSlotsLoading] = useState(false);

  // Samme dobbel-markering av "den andre halvtimen" som på den offentlige
  // bookingsiden (se BookingCalendar.tsx) – hover er kun for pekerenheter med
  // ekte hover (mus), tap/valg virker uansett enhet.
  const [supportsHover] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches
  );
  const [hoveredManualTime, setHoveredManualTime] = useState<string | null>(null);

  const [agendaBusyId, setAgendaBusyId] = useState<string | null>(null);

  // Rask blokkering av HELE den valgte dagen – vises over avtalelisten til
  // høyre for kalenderen, og gjelder alltid akkurat `selectedDate` (oppdaterer
  // seg selv når du klikker en annen dag i kalenderen).
  const [quickWholeDay, setQuickWholeDay] = useState(true);
  const [quickStart, setQuickStart] = useState("");
  const [quickEnd, setQuickEnd] = useState("");
  const [quickNote, setQuickNote] = useState("");
  const [quickSubmitting, setQuickSubmitting] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);

  // Blokkering over flere dager på rad (samme klokkeslett – eller hele dagen
  // – hver dag i rekken) – vises som en smal stripe under kalenderen.
  const [rangeFromDate, setRangeFromDate] = useState("");
  const [rangeToDate, setRangeToDate] = useState("");
  const [rangeWholeDay, setRangeWholeDay] = useState(true);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [rangeNote, setRangeNote] = useState("");
  const [rangeSubmitting, setRangeSubmitting] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);

  // Trenger en slot-oversikt (akkurat som den offentlige bookingsiden) når vi
  // oppretter en ny booking, ELLER redigerer klokkeslettet på en eksisterende
  // enkeltbooking. Gjentakende bookinger/blokkeringer kan ikke få klokkeslettet
  // flyttet her, så da trengs ingen oversikt.
  const needsSlotGrid = modal !== null && (modal.mode === "create" || modal.kind === "single");

  // Samme "slå sammen til én blokk"-oppførsel som på den offentlige
  // bookingsiden (se BookingCalendar.tsx + lib/useSlotMerging.ts) – hooken
  // kalles ubetinget her (regler for hooks), selv om selve rutenettet kun
  // vises inni modalen når needsSlotGrid && modalSlots har innhold.
  const effectiveModalSlots = modalSlots ?? [];
  const manualSelectedIndex = manualTime ? effectiveModalSlots.findIndex((s) => s.label === manualTime) : -1;
  const manualSelectedSecondHalf = secondHalfIndex(effectiveModalSlots, manualSelectedIndex);
  const manualHoveredIndex = supportsHover
    ? effectiveModalSlots.findIndex((s) => s.label === hoveredManualTime)
    : -1;
  const manualHoveredSecondHalf = manualHoveredIndex >= 0 ? secondHalfIndex(effectiveModalSlots, manualHoveredIndex) : -1;

  function manualStateFor(i: number): SlotVisualState {
    const slot = effectiveModalSlots[i];
    if (i === manualSelectedIndex || (manualSelectedSecondHalf >= 0 && i === manualSelectedSecondHalf)) return "selected";
    if (i === manualHoveredIndex || (manualHoveredSecondHalf >= 0 && i === manualHoveredSecondHalf)) return "hover";
    if (!slot.available) return slot.reason === "booked" ? "booked" : "blocked";
    return "normal";
  }

  const manualMergeSlots = useMemo(
    () => effectiveModalSlots.map((s) => ({ startTime: s.startTime, key: s.label })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modalSlots]
  );
  const {
    containerRef: manualGridRef,
    registerButtonRef: registerManualButtonRef,
    mergeLeft: manualMergeLeft,
    mergeRight: manualMergeRight,
    bridges: manualBridges,
  } = useSlotMerging(manualMergeSlots, (_s, i) => manualStateFor(i), [
    manualSelectedIndex,
    manualSelectedSecondHalf,
    manualHoveredIndex,
    manualHoveredSecondHalf,
  ]);

  useEffect(() => {
    if (!modal || !needsSlotGrid) {
      setModalSlots(null);
      return;
    }

    const controller = new AbortController();
    setModalSlotsLoading(true);

    fetch(`/api/squash/availability?date=${modal.date}`, { signal: controller.signal })
      .then((res) => res.json() as Promise<{ slots?: AvailabilitySlot[] }>)
      .then((data) => setModalSlots(data.slots ?? []))
      .catch((err) => {
        if (err?.name !== "AbortError") setModalSlots([]);
      })
      .finally(() => setModalSlotsLoading(false));

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal?.date, needsSlotGrid]);

  // Kalenderen viser alt som faktisk har skjedd med en tid – bekreftet,
  // venter på betaling, ELLER mislyktes (avlyst/utløpt, vist rødt) – mens
  // statistikken og leaderboard (se Leaderboard-komponenten under) kun teller
  // BEKREFTEDE, ekte kundebookinger, siden det er de som representerer
  // faktisk bruk/omsetning.
  const calendarOccurrences = useMemo(
    () => flattenOccurrences(bookings, ["pending", "confirmed", "cancelled", "expired"]),
    [bookings]
  );
  const confirmedCustomerOccurrences = useConfirmedCustomerOccurrences(bookings);

  const occurrencesByDate = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const occ of calendarOccurrences) {
      const list = map.get(occ.dateStr) ?? [];
      list.push(occ);
      map.set(occ.dateStr, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.timeLabel.localeCompare(b.timeLabel));
    return map;
  }, [calendarOccurrences]);

  const selectedDateOccurrences = useMemo(
    () => occurrencesByDate.get(selectedDate) ?? [],
    [occurrencesByDate, selectedDate]
  );

  const stats = useMemo(() => {
    const todayStr = todayInClubTimeZone();
    const todayDate = parseDateOnly(todayStr);
    const weekStart = startOfWeek(todayDate, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(todayDate, { weekStartsOn: 1 });
    const monthStart = startOfMonth(todayDate);
    const monthEnd = endOfMonth(todayDate);

    let day = 0;
    let week = 0;
    let month = 0;
    for (const occ of confirmedCustomerOccurrences) {
      const occDate = parseDateOnly(occ.dateStr);
      if (isSameDay(occDate, todayDate)) day += 1;
      if (isWithinInterval(occDate, { start: weekStart, end: weekEnd })) week += 1;
      if (isWithinInterval(occDate, { start: monthStart, end: monthEnd })) month += 1;
    }
    return { day, week, month };
  }, [confirmedCustomerOccurrences]);

  const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function openCreateModal(dateStr: string) {
    setModal({ mode: "create", date: dateStr });
    setManualTime("");
    setManualName("");
    setManualPhone("");
    setManualError(null);
  }

  function openEditModal(occ: Occurrence) {
    setModal({ mode: "edit", id: occ.id, date: occ.dateStr, kind: occ.kind, label: occ.label, status: occ.status });
    setManualTime(occ.timeLabel);
    setManualName(occ.customerName);
    setManualPhone(occ.customerPhone);
    setManualError(null);
  }

  function closeModal() {
    setModal(null);
  }

  async function handleAgendaCancel(occ: Occurrence) {
    setAgendaBusyId(occ.id);
    try {
      await onCancel(occ.id, occ.label);
    } finally {
      setAgendaBusyId(null);
    }
  }

  /** Delt hjelpefunksjon for begge blokker-skjemaene – POSTer til /api/admin/block og returnerer en feilmelding (eller null ved suksess). */
  async function submitBlock(body: {
    fromDate: string;
    toDate: string;
    wholeDay: boolean;
    startTime?: string;
    endTime?: string;
    note: string;
  }): Promise<string | null> {
    try {
      const res = await fetch("/api/admin/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return data.error ?? "Kunne ikke blokkere tiden.";
      return null;
    } catch {
      return "Kunne ikke blokkere tiden akkurat nå.";
    }
  }

  async function handleQuickBlockSubmit(e: FormEvent) {
    e.preventDefault();
    setQuickSubmitting(true);
    setQuickError(null);
    const err = await submitBlock({
      fromDate: selectedDate,
      toDate: selectedDate,
      wholeDay: quickWholeDay,
      startTime: quickWholeDay ? undefined : quickStart,
      endTime: quickWholeDay ? undefined : quickEnd,
      note: quickNote,
    });
    setQuickSubmitting(false);
    if (err) {
      setQuickError(err);
      return;
    }
    setQuickWholeDay(true);
    setQuickStart("");
    setQuickEnd("");
    setQuickNote("");
    onChanged();
  }

  async function handleRangeBlockSubmit(e: FormEvent) {
    e.preventDefault();
    setRangeSubmitting(true);
    setRangeError(null);
    const err = await submitBlock({
      fromDate: rangeFromDate,
      toDate: rangeToDate || rangeFromDate,
      wholeDay: rangeWholeDay,
      startTime: rangeWholeDay ? undefined : rangeStart,
      endTime: rangeWholeDay ? undefined : rangeEnd,
      note: rangeNote,
    });
    setRangeSubmitting(false);
    if (err) {
      setRangeError(err);
      return;
    }
    setRangeFromDate("");
    setRangeToDate("");
    setRangeWholeDay(true);
    setRangeStart("");
    setRangeEnd("");
    setRangeNote("");
    onChanged();
  }

  async function handleModalSubmit(e: FormEvent) {
    e.preventDefault();
    if (!modal) return;

    setManualSubmitting(true);
    setManualError(null);

    try {
      if (modal.mode === "create") {
        const res = await fetch("/api/admin/bookings/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: modal.date, time: manualTime, name: manualName, phone: manualPhone }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setManualError(data.error ?? "Kunne ikke booke tiden.");
          return;
        }
      } else {
        const body: { name: string; phone: string; date?: string; time?: string; reactivate?: boolean } = {
          name: manualName,
          phone: manualPhone,
        };
        if (modal.kind === "single") {
          body.date = modal.date;
          body.time = manualTime;
        }
        // Redigerer en AVLYST booking – lagre skal da også aktivere den på
        // nytt, ikke bare oppdatere navn/telefon/tid. Se "reactivate"-feltet
        // i app/api/admin/bookings/[id]/route.ts.
        if (modal.status === "cancelled") {
          body.reactivate = true;
        }

        const res = await fetch(`/api/admin/bookings/${modal.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setManualError(data.error ?? (modal.status === "cancelled" ? "Kunne ikke aktivere bookingen på nytt." : "Kunne ikke lagre endringen."));
          return;
        }
      }

      setModal(null);
      onChanged();
    } catch {
      setManualError(
        modal.mode === "create"
          ? "Kunne ikke booke tiden akkurat nå."
          : modal.status === "cancelled"
            ? "Kunne ikke aktivere bookingen på nytt akkurat nå."
            : "Kunne ikke lagre endringen akkurat nå."
      );
    } finally {
      setManualSubmitting(false);
    }
  }

  const submitDisabled = manualSubmitting || (needsSlotGrid && !manualTime);

  return (
    <div className={styles.card}>
      <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Oversikt</h2>

      <div className={styles.statsRow}>
        <div className={styles.statTile}>
          <div className={styles.statTileValue}>{stats.day}</div>
          <div className={styles.statTileLabel}>Bookinger i dag</div>
        </div>
        <div className={styles.statTile}>
          <div className={styles.statTileValue}>{stats.week}</div>
          <div className={styles.statTileLabel}>Bookinger denne uken</div>
        </div>
        <div className={styles.statTile}>
          <div className={styles.statTileValue}>{stats.month}</div>
          <div className={styles.statTileLabel}>Bookinger denne måneden</div>
        </div>
      </div>

      <div className={styles.calendarAgendaRow}>
        <div className={styles.bcWrap}>
          <div className={styles.calHeader}>
            <button
              type="button"
              className={styles.calNav}
              onClick={() => setViewMonth((m) => subMonths(m, 1))}
              aria-label="Forrige måned"
            >
              ‹
            </button>
            <span className={styles.calTitle}>{format(viewMonth, "MMMM yyyy", { locale: nb })}</span>
            <button
              type="button"
              className={styles.calNav}
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              aria-label="Neste måned"
            >
              ›
            </button>
          </div>

          <div className={styles.calWeekdays}>
            {CAL_WEEKDAY_HEADERS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>

          <div className={styles.bcGrid}>
            {days.map((day) => {
              const dateStr = toDateString(day);
              const outsideMonth = !isSameMonth(day, viewMonth);
              const isToday = isSameDay(day, today);
              const isSelected = dateStr === selectedDate;
              const dayOccurrences = occurrencesByDate.get(dateStr) ?? [];
              const { visible, hiddenCount } = pickVisibleForDay(dayOccurrences);

              const classNames = [styles.bcDay];
              if (outsideMonth) classNames.push(styles.bcDayOutside);
              if (isToday) classNames.push(styles.bcDayToday);
              if (isSelected) classNames.push(styles.bcDaySelected);

              return (
                <div
                  key={dateStr}
                  className={classNames.join(" ")}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedDate(dateStr)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedDate(dateStr);
                    }
                  }}
                >
                  <div className={styles.bcDayTop}>
                    <span className={styles.bcDayNumber}>{day.getDate()}</span>
                    <button
                      type="button"
                      className={styles.bcDayAddBtn}
                      aria-label={`Book en tid ${format(day, "d. MMMM", { locale: nb })}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openCreateModal(dateStr);
                      }}
                    >
                      +
                    </button>
                  </div>
                  {visible.length > 0 && (
                    <div className={styles.bcDayEntries}>
                      {visible.map((occ, i) => (
                        <span key={i} className={`${styles.bcEntry} ${entryClassFor(occ)}`}>
                          {occ.timeLabel} {occ.shortText}
                        </span>
                      ))}
                      {hiddenCount > 0 && <span className={styles.bcDayMore}>+{hiddenCount} mer</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className={styles.calLegend}>
            <span>
              <span className={styles.calLegendDot} style={{ background: "var(--ok-dark)" }} />
              Bekreftet
            </span>
            <span>
              <span className={styles.calLegendDot} style={{ background: "#854d0e" }} />
              Venter på betaling
            </span>
            <span>
              <span className={styles.calLegendDot} style={{ background: "#b45309" }} />
              Blokkert
            </span>
            <span>
              <span className={styles.calLegendDot} style={{ background: "var(--danger-dark)" }} />
              Mislyktes (avlyst/utløpt)
            </span>
          </div>

          <form onSubmit={handleRangeBlockSubmit} className={styles.blockStrip}>
            <div className={styles.blockStripTitle}>Blokker flere dager på rad</div>
            <div className={styles.inlineFields}>
              <div>
                <label htmlFor="range-from">Fra dato</label>
                <input
                  id="range-from"
                  type="date"
                  required
                  value={rangeFromDate}
                  onChange={(e) => setRangeFromDate(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="range-to">Til dato</label>
                <input
                  id="range-to"
                  type="date"
                  value={rangeToDate}
                  min={rangeFromDate || undefined}
                  onChange={(e) => setRangeToDate(e.target.value)}
                />
              </div>
              <div>
                <label className={styles.checkboxOption} style={{ marginTop: "20px" }}>
                  <input
                    type="checkbox"
                    checked={rangeWholeDay}
                    onChange={(e) => setRangeWholeDay(e.target.checked)}
                  />
                  Hele dagen
                </label>
              </div>
              {!rangeWholeDay && (
                <>
                  <div>
                    <label htmlFor="range-start">Fra kl.</label>
                    <input
                      id="range-start"
                      type="time"
                      value={rangeStart}
                      onChange={(e) => setRangeStart(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="range-end">Til kl.</label>
                    <input
                      id="range-end"
                      type="time"
                      value={rangeEnd}
                      onChange={(e) => setRangeEnd(e.target.value)}
                    />
                  </div>
                </>
              )}
              <div>
                <label htmlFor="range-note">Forklaring</label>
                <input
                  id="range-note"
                  type="text"
                  maxLength={200}
                  value={rangeNote}
                  onChange={(e) => setRangeNote(e.target.value)}
                  placeholder="F.eks. vedlikehold, turnering …"
                />
              </div>
            </div>
            {rangeError && <p className={styles.error}>{rangeError}</p>}
            <button
              type="submit"
              className={styles.submitButton}
              disabled={
                rangeSubmitting ||
                !rangeFromDate ||
                !rangeNote.trim() ||
                (!rangeWholeDay && (!rangeStart || !rangeEnd))
              }
            >
              {rangeSubmitting ? "Blokkerer …" : "Blokker"}
            </button>
          </form>
        </div>

        <div className={styles.agendaPanel}>
          <div className={styles.quickBlockBox}>
            <h3 style={{ marginTop: 0, fontSize: "1rem" }}>
              Blokker {format(parseDateOnly(selectedDate), "EEEE d. MMMM", { locale: nb })}
            </h3>
            <form onSubmit={handleQuickBlockSubmit} className={styles.form}>
              <label className={styles.checkboxOption}>
                <input
                  type="checkbox"
                  checked={quickWholeDay}
                  onChange={(e) => setQuickWholeDay(e.target.checked)}
                />
                Hele dagen
              </label>
              {!quickWholeDay && (
                <div className={styles.inlineFields}>
                  <div>
                    <label htmlFor="quick-start">Fra</label>
                    <input
                      id="quick-start"
                      type="time"
                      value={quickStart}
                      onChange={(e) => setQuickStart(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="quick-end">Til</label>
                    <input
                      id="quick-end"
                      type="time"
                      value={quickEnd}
                      onChange={(e) => setQuickEnd(e.target.value)}
                    />
                  </div>
                </div>
              )}
              <div className={styles.formRow}>
                <label htmlFor="quick-note">Forklaring</label>
                <input
                  id="quick-note"
                  type="text"
                  maxLength={200}
                  value={quickNote}
                  onChange={(e) => setQuickNote(e.target.value)}
                  placeholder="F.eks. vedlikehold, turnering …"
                />
              </div>
              {quickError && <p className={styles.error}>{quickError}</p>}
              <button
                type="submit"
                className={styles.submitButton}
                disabled={quickSubmitting || !quickNote.trim() || (!quickWholeDay && (!quickStart || !quickEnd))}
              >
                {quickSubmitting ? "Blokkerer …" : "Blokker dagen"}
              </button>
            </form>
          </div>

          <h3 style={{ marginTop: 0, fontSize: "1rem" }}>
            Avtaler {format(parseDateOnly(selectedDate), "EEEE d. MMMM", { locale: nb })}
          </h3>
          {selectedDateOccurrences.length === 0 && <p className={styles.bookingMeta}>Ingen bookinger denne dagen.</p>}
          {selectedDateOccurrences.length > 0 && (
            <div className={styles.agendaList}>
              {selectedDateOccurrences.map((occ, i) => {
                const canCancel = occ.status === "pending" || occ.status === "confirmed";
                // Avlyste tider kan også redigeres – modalen tilbyr da å
                // aktivere dem på nytt (se "Rediger"-knappens oppførsel
                // under og handleModalSubmit), f.eks. hvis avlysningen var
                // en feil eller gjesten likevel kommer. Utløpte bookinger
                // (betaling fullført aldri) og blokkeringer kan ikke det.
                const canEdit = (canCancel || occ.status === "cancelled") && occ.kind !== "block";
                const busy = agendaBusyId === occ.id;

                return (
                  <div key={i} className={`${styles.agendaRow} ${occ.statusClass}`}>
                    <div className={styles.agendaRowText}>
                      <span className={occ.failed ? styles.agendaRowLabelFailed : undefined}>{occ.label}</span>
                      {occ.failed && <span className={styles.bookingMeta}> – {STATUS_LABEL_NB[occ.status]}</span>}
                    </div>
                    {(canCancel || canEdit) && (
                      <div className={styles.agendaRowActions}>
                        {canEdit && (
                          <button type="button" className={styles.linkButton} onClick={() => openEditModal(occ)}>
                            {occ.status === "cancelled" ? "Aktiver igjen" : "Rediger"}
                          </button>
                        )}
                        {canCancel && (
                          <button
                            type="button"
                            className={styles.linkButtonDanger}
                            disabled={busy}
                            onClick={() => handleAgendaCancel(occ)}
                          >
                            {busy ? "Avlyser …" : occ.kind === "block" ? "Fjern blokkering" : "Avlys"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {modal && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, fontSize: "1.05rem" }}>
              {modal.mode === "create" ? "Book uten betaling" : modal.status === "cancelled" ? "Aktiver booking på nytt" : "Rediger booking"} –{" "}
              {format(parseDateOnly(modal.date), "EEEE d. MMMM", { locale: nb })}
            </h3>
            <p className={styles.bookingMeta}>
              {modal.mode === "create"
                ? "Bookingen varer alltid 1 time og er bekreftet med en gang, uten Vipps."
                : modal.status === "cancelled"
                  ? modal.kind === "single"
                    ? "Denne tiden er avlyst. Lagre for å aktivere den igjen – velg et annet klokkeslett hvis det opprinnelige er opptatt av noen andre nå."
                    : "Denne rekken er avlyst. Lagre for å aktivere den igjen (klokkeslettene kan ikke endres her)."
                  : modal.kind === "single"
                    ? "Velg et nytt klokkeslett, eller la det stå som det er."
                    : "Klokkeslett kan ikke endres her for gjentakende bookinger eller blokkeringer – kun navn/telefon."}
            </p>

            {needsSlotGrid && (
              <>
                {modalSlotsLoading && <p className={styles.bookingMeta}>Henter ledige tider …</p>}
                {!modalSlotsLoading && modalSlots && modalSlots.length === 0 && (
                  <p className={styles.bookingMeta}>Stengt denne dagen.</p>
                )}
                {!modalSlotsLoading && modalSlots && modalSlots.length > 0 && (
                  <div className={styles.manualSlotGrid} ref={manualGridRef}>
                    {modalSlots.map((slot, i) => {
                      const isSelected = manualTime === slot.label;
                      const disabled = !slot.available && !isSelected;
                      const state = manualStateFor(i);
                      const classNames = [styles.manualSlotButton];
                      // "blocked" (grått) = kun utilgjengelig som starttidspunkt,
                      // ikke selv fysisk opptatt – samme skille som den offentlige
                      // bookingsiden (se reason i app/api/squash/availability).
                      if (state === "blocked") classNames.push(styles.manualSlotButtonAdjacent);
                      if (state === "selected") classNames.push(styles.manualSlotButtonSelected);
                      else if (state === "hover") classNames.push(styles.manualSlotButtonHoverPreview);
                      if (manualMergeRight(slot.label)) classNames.push(styles.manualMergeRight);
                      if (manualMergeLeft(slot.label)) classNames.push(styles.manualMergeLeft);
                      return (
                        <button
                          key={slot.startTime}
                          ref={registerManualButtonRef(slot.label)}
                          type="button"
                          disabled={disabled}
                          className={classNames.join(" ")}
                          onClick={() => setManualTime(slot.label)}
                          onMouseEnter={() => {
                            if (supportsHover && !disabled) setHoveredManualTime(slot.label);
                          }}
                          onMouseLeave={() => {
                            if (supportsHover)
                              setHoveredManualTime((current) => (current === slot.label ? null : current));
                          }}
                        >
                          {slot.label}
                        </button>
                      );
                    })}
                    {manualBridges.map((bridge) => (
                      <div
                        key={bridge.key}
                        aria-hidden
                        className={`${styles.manualSlotBridge} ${
                          bridge.state === "selected"
                            ? styles.manualSlotBridgeSelected
                            : bridge.state === "hover"
                              ? styles.manualSlotBridgeHoverPreview
                              : bridge.state === "booked"
                                ? styles.manualSlotBridgeBooked
                                : styles.manualSlotBridgeBlocked
                        }`}
                        style={{ left: bridge.left, top: bridge.top, width: bridge.width, height: bridge.height }}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            <form onSubmit={handleModalSubmit} className={styles.form}>
              <div className={styles.formRow}>
                <label htmlFor="manual-name">Navn</label>
                <input
                  id="manual-name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={100}
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                />
              </div>
              <div className={styles.formRow}>
                <label htmlFor="manual-phone">Telefon (valgfritt)</label>
                <input
                  id="manual-phone"
                  type="tel"
                  value={manualPhone}
                  onChange={(e) => setManualPhone(e.target.value)}
                />
              </div>
              {manualError && <p className={styles.error}>{manualError}</p>}
              <div style={{ display: "flex", gap: "8px" }}>
                <button type="submit" className={styles.submitButton} disabled={submitDisabled}>
                  {manualSubmitting
                    ? modal.mode === "edit" && modal.status === "cancelled"
                      ? "Aktiverer …"
                      : "Lagrer …"
                    : modal.mode === "create"
                      ? "Book tiden"
                      : modal.status === "cancelled"
                        ? "Aktiver på nytt"
                        : "Lagre endringer"}
                </button>
                <button type="button" className={styles.secondaryButton} onClick={closeModal}>
                  Avbryt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * "Mest aktive bookere" – en egen komponent (i stedet for å være en del av
 * BookingsInsights sin JSX-tre) slik at AdminDashboard kan plassere den side
 * om side med bookinglisten nederst, i stedet for stablet under kalenderen.
 * Begge blir lange og lengre jo flere som booker, så de ligger nederst slik
 * at de ikke dytter kalenderen/agendaen langt ned.
 */
export function Leaderboard({ bookings }: { bookings: BookingRow[] }) {
  const confirmedCustomerOccurrences = useConfirmedCustomerOccurrences(bookings);

  const leaderboard = useMemo(() => {
    const byPhone = new Map<string, { name: string; phone: string; count: number }>();
    for (const occ of confirmedCustomerOccurrences) {
      const key = occ.customerPhone || occ.customerName;
      const entry = byPhone.get(key);
      if (entry) entry.count += 1;
      else byPhone.set(key, { name: occ.customerName, phone: occ.customerPhone, count: 1 });
    }
    return Array.from(byPhone.values()).sort((a, b) => b.count - a.count);
  }, [confirmedCustomerOccurrences]);

  return (
    <>
      <h3 style={{ marginTop: 0, fontSize: "1rem" }}>Mest aktive bookere</h3>
      {leaderboard.length === 0 && <p className={styles.bookingMeta}>Ingen bekreftede bookinger ennå.</p>}
      {leaderboard.length > 0 && (
        <div className={styles.leaderboardList}>
          {leaderboard.map((entry, i) => (
            <div key={entry.phone || entry.name} className={styles.leaderboardRow}>
              <span className={styles.leaderboardRank}>{i + 1}.</span>
              <div className={styles.leaderboardInfo}>
                <div className={styles.leaderboardName}>{entry.name}</div>
                {entry.phone && <div className={styles.leaderboardMeta}>{entry.phone}</div>}
              </div>
              <span className={styles.leaderboardCount}>
                {entry.count} {entry.count === 1 ? "booking" : "bookinger"}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
