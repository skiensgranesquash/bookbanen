"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { nb } from "date-fns/locale";
import styles from "../admin.module.css";
import AdminNav from "../AdminNav";

type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

const WEEKDAY_KEYS: WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  mon: "Mandag",
  tue: "Tirsdag",
  wed: "Onsdag",
  thu: "Torsdag",
  fri: "Fredag",
  sat: "Lørdag",
  sun: "Søndag",
};
const CAL_WEEKDAY_HEADERS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];

/** Standardverdi for et nytt tidsrom man legger til – admin justerer klokkeslettene selv etterpå. */
const NEW_INTERVAL_DEFAULT: TimeInterval = { open: "12:00", close: "17:00" };

interface TimeInterval {
  open: string;
  close: string;
}

interface DayHours {
  closed: boolean;
  /** Ett eller flere ikke-overlappende tidsrom samme dag (f.eks. lunsjstengt mellom to). Tom når closed=true. */
  intervals: TimeInterval[];
}

type WeeklyHours = Record<WeekdayKey, DayHours>;

interface CalendarException {
  date: string;
  closed: boolean;
  intervals: TimeInterval[];
  note: string;
}

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

function formatIntervals(intervals: TimeInterval[]): string {
  return intervals.map((i) => `${i.open}–${i.close}`).join(", ");
}

/** Gjenbrukt av både ukedag-rader og unntaksskjemaet: liste over tidsrom med redigering, fjerning og "legg til"-knapp. */
function IntervalEditor({
  intervals,
  onChange,
}: {
  intervals: TimeInterval[];
  onChange: (next: TimeInterval[]) => void;
}) {
  function updateAt(index: number, patch: Partial<TimeInterval>) {
    onChange(intervals.map((interval, i) => (i === index ? { ...interval, ...patch } : interval)));
  }

  function removeAt(index: number) {
    onChange(intervals.filter((_, i) => i !== index));
  }

  function add() {
    onChange([...intervals, NEW_INTERVAL_DEFAULT]);
  }

  return (
    <div className={styles.weekRowIntervals}>
      {intervals.map((interval, index) => (
        <div key={index} className={styles.intervalRow}>
          <input
            type="time"
            value={interval.open}
            onChange={(e) => updateAt(index, { open: e.target.value })}
            aria-label="Åpner"
          />
          <span>–</span>
          <input
            type="time"
            value={interval.close}
            onChange={(e) => updateAt(index, { close: e.target.value })}
            aria-label="Stenger"
          />
          <button
            type="button"
            className={styles.intervalRemoveButton}
            onClick={() => removeAt(index)}
            disabled={intervals.length <= 1}
            title={intervals.length <= 1 ? "Bruk «Stengt» hvis dagen ikke skal ha noen tidsrom" : "Fjern dette tidsrommet"}
            aria-label="Fjern tidsrom"
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className={styles.addIntervalButton} onClick={add}>
        + Legg til tidsrom
      </button>
    </div>
  );
}

export default function OpeningHoursManager() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [weekly, setWeekly] = useState<WeeklyHours | null>(null);
  const [savingWeekly, setSavingWeekly] = useState(false);
  const [weeklyMessage, setWeeklyMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [exceptions, setExceptions] = useState<CalendarException[]>([]);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());

  const [formClosed, setFormClosed] = useState(true);
  const [formIntervals, setFormIntervals] = useState<TimeInterval[]>([{ open: "05:00", close: "23:00" }]);
  const [formNote, setFormNote] = useState("");
  const [savingExceptions, setSavingExceptions] = useState(false);
  const [excMessage, setExcMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Siste dato for gjentakende bookinger (se lib/settings/recurringLimit.ts)
  // – egen, uavhengig henting/lagring, siden den ligger i et helt eget
  // API-endepunkt (ikke en del av /api/admin/settings/hours).
  const [cutoffDate, setCutoffDate] = useState("");
  const [cutoffLoading, setCutoffLoading] = useState(true);
  const [savingCutoff, setSavingCutoff] = useState(false);
  const [cutoffMessage, setCutoffMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Priser for 30 min/1 time (se lib/settings/pricing.ts) – holdt som tekst
  // (kr, med evt. komma/desimal) i selve input-feltene mens man skriver, og
  // konvertert til øre først når man faktisk lagrer.
  const [price30, setPrice30] = useState("");
  const [price60, setPrice60] = useState("");
  const [priceLoading, setPriceLoading] = useState(true);
  const [savingPrice, setSavingPrice] = useState(false);
  const [priceMessage, setPriceMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings/price", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("Kunne ikke hente priser.");
        return res.json() as Promise<{ price30MinOre: number; price60MinOre: number }>;
      })
      .then((data) => {
        setPrice30(String(data.price30MinOre / 100));
        setPrice60(String(data.price60MinOre / 100));
      })
      .catch(() => {
        // Ikke kritisk nok til å blokkere resten av siden – feltene starter bare tomme.
      })
      .finally(() => setPriceLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/admin/settings/hours", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("Kunne ikke hente åpningstider.");
        return res.json() as Promise<{ weekly: WeeklyHours; exceptions: CalendarException[] }>;
      })
      .then((data) => {
        setWeekly(data.weekly);
        setExceptions(data.exceptions);
      })
      .catch(() => setLoadError("Kunne ikke hente åpningstider akkurat nå."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/admin/settings/recurring-limit", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("Kunne ikke hente grensen.");
        return res.json() as Promise<{ cutoffDate: string | null }>;
      })
      .then((data) => setCutoffDate(data.cutoffDate ?? ""))
      .catch(() => {
        // Ikke kritisk nok til å blokkere resten av siden – feltet starter bare tomt.
      })
      .finally(() => setCutoffLoading(false));
  }, []);

  const exceptionByDate = useMemo(() => {
    const map = new Map<string, CalendarException>();
    for (const e of exceptions) map.set(e.date, e);
    return map;
  }, [exceptions]);

  async function handleSaveWeekly(e: FormEvent) {
    e.preventDefault();
    if (!weekly) return;
    setSavingWeekly(true);
    setWeeklyMessage(null);

    try {
      const res = await fetch("/api/admin/settings/hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekly }),
      });
      const data = (await res.json()) as { error?: string; weekly?: WeeklyHours };
      if (!res.ok) {
        setWeeklyMessage({ ok: false, text: data.error ?? "Kunne ikke lagre." });
        return;
      }
      if (data.weekly) setWeekly(data.weekly);
      setWeeklyMessage({ ok: true, text: "Ukentlige åpningstider lagret." });
    } catch {
      setWeeklyMessage({ ok: false, text: "Kunne ikke lagre akkurat nå." });
    } finally {
      setSavingWeekly(false);
    }
  }

  async function handleSaveCutoff(e: FormEvent) {
    e.preventDefault();
    setSavingCutoff(true);
    setCutoffMessage(null);

    try {
      const res = await fetch("/api/admin/settings/recurring-limit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cutoffDate: cutoffDate || null }),
      });
      const data = (await res.json()) as { error?: string; cutoffDate?: string | null };
      if (!res.ok) {
        setCutoffMessage({ ok: false, text: data.error ?? "Kunne ikke lagre." });
        return;
      }
      setCutoffDate(data.cutoffDate ?? "");
      setCutoffMessage({ ok: true, text: data.cutoffDate ? "Dato lagret." : "Grense fjernet." });
    } catch {
      setCutoffMessage({ ok: false, text: "Kunne ikke lagre akkurat nå." });
    } finally {
      setSavingCutoff(false);
    }
  }

  async function handleClearCutoff() {
    setSavingCutoff(true);
    setCutoffMessage(null);

    try {
      const res = await fetch("/api/admin/settings/recurring-limit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cutoffDate: null }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setCutoffMessage({ ok: false, text: data.error ?? "Kunne ikke fjerne." });
        return;
      }
      setCutoffDate("");
      setCutoffMessage({ ok: true, text: "Grense fjernet – kun maks antall uker gjelder nå." });
    } catch {
      setCutoffMessage({ ok: false, text: "Kunne ikke fjerne akkurat nå." });
    } finally {
      setSavingCutoff(false);
    }
  }

  async function handleSavePrice(e: FormEvent) {
    e.preventDefault();
    setSavingPrice(true);
    setPriceMessage(null);

    const parsedPrice30 = Math.round(Number(price30.replace(",", ".")) * 100);
    const parsedPrice60 = Math.round(Number(price60.replace(",", ".")) * 100);

    try {
      const res = await fetch("/api/admin/settings/price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price30MinOre: parsedPrice30, price60MinOre: parsedPrice60 }),
      });
      const data = (await res.json()) as { error?: string; price30MinOre?: number; price60MinOre?: number };
      if (!res.ok) {
        setPriceMessage({ ok: false, text: data.error ?? "Kunne ikke lagre." });
        return;
      }
      if (typeof data.price30MinOre === "number") setPrice30(String(data.price30MinOre / 100));
      if (typeof data.price60MinOre === "number") setPrice60(String(data.price60MinOre / 100));
      setPriceMessage({ ok: true, text: "Priser lagret." });
    } catch {
      setPriceMessage({ ok: false, text: "Kunne ikke lagre akkurat nå." });
    } finally {
      setSavingPrice(false);
    }
  }

  function updateDay(key: WeekdayKey, patch: Partial<DayHours>) {
    setWeekly((prev) => (prev ? { ...prev, [key]: { ...prev[key], ...patch } } : prev));
  }

  function toggleDateSelection(dateStr: string) {
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr);
      else next.add(dateStr);
      return next;
    });
  }

  function clearSelection() {
    setSelectedDates(new Set());
  }

  function loadExceptionIntoForm(exception: CalendarException) {
    setSelectedDates(new Set([exception.date]));
    setFormClosed(exception.closed);
    setFormIntervals(exception.intervals.length > 0 ? exception.intervals : [{ open: "05:00", close: "23:00" }]);
    setFormNote(exception.note);
  }

  async function handleApplyToSelected() {
    if (selectedDates.size === 0) return;
    setSavingExceptions(true);
    setExcMessage(null);

    try {
      const res = await fetch("/api/admin/settings/hours/exceptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dates: Array.from(selectedDates),
          closed: formClosed,
          intervals: formClosed ? undefined : formIntervals,
          note: formNote,
        }),
      });
      const data = (await res.json()) as { error?: string; exceptions?: CalendarException[] };
      if (!res.ok) {
        setExcMessage({ ok: false, text: data.error ?? "Kunne ikke lagre." });
        return;
      }
      if (data.exceptions) setExceptions(data.exceptions);
      setExcMessage({
        ok: true,
        text: `Lagret for ${selectedDates.size} ${selectedDates.size === 1 ? "dag" : "dager"}.`,
      });
      clearSelection();
      setFormNote("");
    } catch {
      setExcMessage({ ok: false, text: "Kunne ikke lagre akkurat nå." });
    } finally {
      setSavingExceptions(false);
    }
  }

  async function handleRemoveSelected() {
    const dates = Array.from(selectedDates);
    if (dates.length === 0) return;
    setSavingExceptions(true);
    setExcMessage(null);

    try {
      const res = await fetch("/api/admin/settings/hours/exceptions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dates }),
      });
      const data = (await res.json()) as { error?: string; exceptions?: CalendarException[] };
      if (!res.ok) {
        setExcMessage({ ok: false, text: data.error ?? "Kunne ikke fjerne." });
        return;
      }
      if (data.exceptions) setExceptions(data.exceptions);
      setExcMessage({ ok: true, text: "Unntak fjernet – tilbake til ukedagens standard." });
      clearSelection();
    } catch {
      setExcMessage({ ok: false, text: "Kunne ikke fjerne akkurat nå." });
    } finally {
      setSavingExceptions(false);
    }
  }

  async function handleRemoveOne(dateStr: string) {
    setSavingExceptions(true);
    setExcMessage(null);
    try {
      const res = await fetch("/api/admin/settings/hours/exceptions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dates: [dateStr] }),
      });
      const data = (await res.json()) as { error?: string; exceptions?: CalendarException[] };
      if (res.ok && data.exceptions) setExceptions(data.exceptions);
    } finally {
      setSavingExceptions(false);
    }
  }

  const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <>
      <AdminNav active="apningstider" />
      <main className={styles.page}>
        <div className={styles.tabPanel}>
          <h1 className={styles.title}>Åpningstider</h1>
          <p className={styles.subtitle}>Standard åpningstider per ukedag, pluss ferier og andre annerledesdager.</p>

      <div className={styles.card}>
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Pris</h2>
        <p className={styles.bookingMeta}>
          Pris for 30 minutter og pris for 1 time settes helt uavhengig av hverandre, og gjelder umiddelbart for alle
          nye bookinger (endrer ikke prisen på allerede betalte bookinger).
        </p>
        {priceLoading ? (
          <p>Laster …</p>
        ) : (
          <form onSubmit={handleSavePrice} className={styles.form}>
            <div className={styles.formRow}>
              <label htmlFor="price-30">Pris for 30 minutter (kr)</label>
              <input
                id="price-30"
                type="number"
                min={0}
                step="0.5"
                value={price30}
                onChange={(e) => setPrice30(e.target.value)}
              />
            </div>
            <div className={styles.formRow}>
              <label htmlFor="price-60">Pris for 1 time (kr)</label>
              <input
                id="price-60"
                type="number"
                min={0}
                step="0.5"
                value={price60}
                onChange={(e) => setPrice60(e.target.value)}
              />
            </div>

            {priceMessage && <p className={priceMessage.ok ? styles.success : styles.error}>{priceMessage.text}</p>}

            <button type="submit" className={styles.submitButton} disabled={savingPrice || !price30 || !price60}>
              {savingPrice ? "Lagrer …" : "Lagre priser"}
            </button>
          </form>
        )}
      </div>

      <div className={styles.card}>
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Grense for gjentakende bookinger</h2>
        <p className={styles.bookingMeta}>
          Siste dato en gjentakende (ukentlig) booking har lov til å dekke. Du får en påminnelse her i adminpanelet
          når datoen nærmer seg (siste uke før den passerer), og hver dag etter at den har passert – helt til du
          setter en ny dato. La feltet stå tomt for å kun bruke det vanlige maks-antallet uker.
        </p>
        {cutoffLoading ? (
          <p>Laster …</p>
        ) : (
          <form onSubmit={handleSaveCutoff} className={styles.form}>
            <div className={styles.formRow}>
              <label htmlFor="recurring-cutoff">Siste dato</label>
              <input
                id="recurring-cutoff"
                type="date"
                value={cutoffDate}
                onChange={(e) => setCutoffDate(e.target.value)}
              />
            </div>

            {cutoffMessage && <p className={cutoffMessage.ok ? styles.success : styles.error}>{cutoffMessage.text}</p>}

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button type="submit" className={styles.submitButton} disabled={savingCutoff || !cutoffDate}>
                {savingCutoff ? "Lagrer …" : "Lagre dato"}
              </button>
              <button
                type="button"
                className={styles.dangerButton}
                disabled={savingCutoff || !cutoffDate}
                onClick={handleClearCutoff}
              >
                Fjern grense
              </button>
            </div>
          </form>
        )}
      </div>

      {loading && <p>Laster …</p>}
      {loadError && <p className={styles.error}>{loadError}</p>}

      {!loading && weekly && (
        <>
          <div className={styles.card}>
            <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Ukentlige åpningstider</h2>
            <p className={styles.bookingMeta}>
              Gjelder alle dager, bortsett fra datoer som er satt opp med noe annet i kalenderen under. Legg til flere
              tidsrom på samme dag hvis det f.eks. er åpent 05–11 og 12–17 (lunsjstengt mellom).
            </p>
            <form onSubmit={handleSaveWeekly} className={styles.form}>
              {WEEKDAY_KEYS.map((key) => {
                const day = weekly[key];
                return (
                  <div key={key} className={styles.weekRow}>
                    <span className={styles.weekRowLabel}>{WEEKDAY_LABELS[key]}</span>
                    <label className={styles.weekRowClosedToggle}>
                      <input
                        type="checkbox"
                        checked={day.closed}
                        onChange={(e) => updateDay(key, { closed: e.target.checked })}
                      />
                      Stengt
                    </label>
                    {day.closed ? (
                      <span className={styles.weekRowClosedLabel}>Ingen booking denne ukedagen.</span>
                    ) : (
                      <IntervalEditor
                        intervals={day.intervals}
                        onChange={(next) => updateDay(key, { intervals: next })}
                      />
                    )}
                  </div>
                );
              })}

              {weeklyMessage && (
                <p className={weeklyMessage.ok ? styles.success : styles.error} style={{ marginTop: 10 }}>
                  {weeklyMessage.text}
                </p>
              )}

              <button type="submit" className={styles.submitButton} disabled={savingWeekly} style={{ marginTop: 10 }}>
                {savingWeekly ? "Lagrer …" : "Lagre ukentlige åpningstider"}
              </button>
            </form>
          </div>

          <div className={styles.card}>
            <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Ferier og annerledesdager</h2>
            <p className={styles.bookingMeta}>
              Klikk én eller flere dager i kalenderen for å markere dem (f.eks. hele juleferien), velg om dagen(e)
              skal være helt stengt eller ha egne klokkeslett (gjerne flere tidsrom), og lagre – gjelder for alle de
              valgte dagene samtidig.
            </p>

            <div className={styles.hoursLayout}>
              <div className={styles.calWrap}>
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

                <div className={styles.calGrid}>
                  {days.map((day) => {
                    const dateStr = toDateString(day);
                    const outsideMonth = !isSameMonth(day, viewMonth);
                    const isSelected = selectedDates.has(dateStr);
                    const isToday = isSameDay(day, today);
                    const exception = exceptionByDate.get(dateStr);

                    const classNames = [styles.calDay];
                    if (outsideMonth) classNames.push(styles.calDayOutside);
                    if (isSelected) classNames.push(styles.calDaySelected);
                    if (isToday && !isSelected) classNames.push(styles.calDayToday);
                    if (exception) classNames.push(exception.closed ? styles.calDayException : styles.calDayExceptionCustom);

                    return (
                      <button
                        key={dateStr}
                        type="button"
                        className={classNames.join(" ")}
                        onClick={() => toggleDateSelection(dateStr)}
                        title={
                          exception
                            ? exception.note || (exception.closed ? "Stengt" : formatIntervals(exception.intervals))
                            : undefined
                        }
                      >
                        {day.getDate()}
                      </button>
                    );
                  })}
                </div>

                <div className={styles.calLegend}>
                  <span>
                    <span className={styles.calLegendDot} style={{ background: "var(--danger-dark)" }} />
                    Stengt
                  </span>
                  <span>
                    <span className={styles.calLegendDot} style={{ background: "#b45309" }} />
                    Egne tider
                  </span>
                </div>
              </div>

              <div className={styles.excPanel}>
                <div className={styles.excSelectedCount}>
                  {selectedDates.size === 0
                    ? "Ingen dager valgt."
                    : `${selectedDates.size} ${selectedDates.size === 1 ? "dag valgt" : "dager valgt"}.`}{" "}
                  {selectedDates.size > 0 && (
                    <button type="button" className={styles.linkButton} onClick={clearSelection}>
                      Nullstill valg
                    </button>
                  )}
                </div>

                <div className={styles.formRow}>
                  <label className={styles.checkboxOption}>
                    <input type="checkbox" checked={formClosed} onChange={(e) => setFormClosed(e.target.checked)} />
                    Helt stengt
                  </label>
                </div>

                {!formClosed && (
                  <div style={{ marginBottom: 10 }}>
                    <IntervalEditor intervals={formIntervals} onChange={setFormIntervals} />
                  </div>
                )}

                <div className={styles.formRow}>
                  <label htmlFor="exc-note">Forklaring (vises for dere, og på bookingsiden hvis stengt)</label>
                  <input
                    id="exc-note"
                    type="text"
                    placeholder="F.eks. Jul, Dugnad, Sommerstengt"
                    value={formNote}
                    onChange={(e) => setFormNote(e.target.value)}
                  />
                </div>

                {excMessage && (
                  <p className={excMessage.ok ? styles.success : styles.error} style={{ marginBottom: 10 }}>
                    {excMessage.text}
                  </p>
                )}

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className={styles.submitButton}
                    disabled={selectedDates.size === 0 || savingExceptions}
                    onClick={handleApplyToSelected}
                  >
                    {savingExceptions ? "Lagrer …" : "Lagre for valgte dager"}
                  </button>
                  <button
                    type="button"
                    className={styles.dangerButton}
                    disabled={selectedDates.size === 0 || savingExceptions}
                    onClick={handleRemoveSelected}
                  >
                    Fjern unntak for valgte dager
                  </button>
                </div>

                {exceptions.length > 0 && (
                  <div className={styles.excList}>
                    {exceptions.map((exception) => (
                      <div key={exception.date} className={styles.excListRow}>
                        <div>
                          <strong>{format(parseDateOnly(exception.date), "EEEE d. MMM yyyy", { locale: nb })}</strong>
                          <div className={styles.excListMeta}>
                            {exception.closed ? "Stengt" : formatIntervals(exception.intervals)}
                            {exception.note ? ` · ${exception.note}` : ""}
                          </div>
                        </div>
                        <div className={styles.excListActions}>
                          <button type="button" className={styles.linkButton} onClick={() => loadExceptionIntoForm(exception)}>
                            Rediger
                          </button>
                          <button
                            type="button"
                            className={styles.linkButtonDanger}
                            onClick={() => handleRemoveOne(exception.date)}
                          >
                            Fjern
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
        </div>
      </main>
    </>
  );
}
