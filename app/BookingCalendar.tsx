"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import styles from "./booking.module.css";
import DatePicker from "./DatePicker";
import { MAX_RECURRING_WEEKS, SLOT_LENGTH_MINUTES, type BookingDurationMinutes } from "@/lib/config";
import { maxBookableDate, maxRecurringWeeksUntil, todayInClubTimeZone } from "@/lib/slots";
import { formatDurationMinutes, formatOslo, formatPriceOre } from "@/lib/formatting";
import { normalizeNorwegianMobile } from "@/lib/phone";
import { useSlotMerging, type SlotVisualState } from "@/lib/useSlotMerging";

interface AvailabilitySlot {
  startTime: string;
  endTime: string;
  label: string;
  /** Om akkurat DENNE fysiske halvtimen er ledig. */
  available: boolean;
  /** Kun satt når available er false. Se app/api/squash/availability/route.ts. */
  reason?: "booked";
  /** Om en hel time kan starte akkurat her (begge halvtimene er ledige). Styrer om "1 time"-valget kan velges i varighetsvelgeren under. */
  canExtendToHour: boolean;
}

interface AvailabilityResponse {
  date: string;
  slots: AvailabilitySlot[];
  closed?: boolean;
  note?: string | null;
  error?: string;
}

interface RecurringOccurrence {
  date: string;
  startTime: string;
  endTime: string;
  available: boolean;
  reason?: "taken" | "closed" | null;
  note?: string | null;
}

interface RecurringPreviewResponse {
  occurrences: RecurringOccurrence[];
  allAvailable: boolean;
  totalAmountOre: number;
  error?: string;
}

/**
 * Om en gitt rutenett-slot i det hele tatt kan TRYKKES PÅ for å åpne
 * varighetsvelgeren (se duration-state under) – dvs. at denne fysiske
 * halvtimen selv er ledig. Om man deretter faktisk FÅR velge "1 time" der
 * avgjøres separat av slottens eget `canExtendToHour`-flagg.
 */
function isBookableSlot(slots: AvailabilitySlot[], i: number): boolean {
  return i >= 0 && i < slots.length && slots[i].available;
}

/** Om starttidspunktet til en rutenett-slot allerede har passert "nå". */
function isPastStart(slot: AvailabilitySlot, nowMs: number): boolean {
  return new Date(slot.startTime).getTime() <= nowMs;
}

/**
 * Finner indeksen til rutenett-slotten som utgjør den ANDRE halvtimen av en
 * hel økt som starter ved `slots[i]` – altså slotten hvis EGET starttidspunkt
 * er nøyaktig SLOT_LENGTH_MINUTES senere. Vi leter etter den via faktisk
 * klokkeslett (ikke bare array-indeks + 1), fordi rutenettet kan ha hopp i
 * seg (f.eks. stengt i en lunsjpause mellom to åpningstidsintervaller) – da
 * er IKKE "neste element i arrayet" nødvendigvis den fysisk påfølgende
 * halvtimen. Returnerer -1 hvis den ikke finnes (f.eks. slot i er siste
 * bookbare i rutenettet og andre halvtime ikke selv er en egen rutenett-slot
 * lenger ute, eller passerer en stengt pause).
 */
function secondHalfIndex(slots: AvailabilitySlot[], i: number): number {
  if (i < 0 || i >= slots.length) return -1;
  const target = new Date(slots[i].startTime).getTime() + SLOT_LENGTH_MINUTES * 60_000;
  return slots.findIndex((s) => new Date(s.startTime).getTime() === target);
}

const REMEMBERED_NAME_KEY = "squash-booking-name";
const REMEMBERED_PHONE_KEY = "squash-booking-phone";

/**
 * Husker navn/telefon i DENNE nettleseren (localStorage) mellom besøk, slik
 * at man slipper å skrive det inn på nytt hver gang man booker en ny time.
 * Rent lokalt i brukerens egen nettleser – ligger ikke lagret noe sted på
 * serveren før man faktisk fullfører en booking. Pakkes inn i try/catch
 * siden localStorage kan mangle/kaste i privat nettlesing e.l.
 */
function readRemembered(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeRemembered(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Ignorer – kun en bekvemmelighet, ikke kritisk for at booking skal virke.
  }
}

interface BookingCalendarProps {
  /** Siste dato en gjentakende booking har lov til å dekke (satt av klubben i adminpanelet), eller null for ingen egen grense – se lib/settings/recurringLimit.ts. */
  recurringCutoffDate: string | null;
  /** Dagens priser (i øre), satt av klubben i adminpanelet – se lib/settings/pricing.ts. De to er HELT uavhengige av hverandre (1 time er ikke nødvendigvis dobbelt så dyrt som 30 min). */
  price30MinOre: number;
  price60MinOre: number;
}

export default function BookingCalendar({ recurringCutoffDate, price30MinOre, price60MinOre }: BookingCalendarProps) {
  const today = useMemo(() => todayInClubTimeZone(), []);
  const maxDate = useMemo(() => maxBookableDate(), []);

  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [closedInfo, setClosedInfo] = useState<{ closed: boolean; note: string | null } | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  // Varigheten kunden har valgt for `selectedLabel` – `null` mens valget
  // venter (rett etter at man har trykket på et klokkeslett, FØR man har
  // svart "30 min" eller "1 time" i velgeren som da vises, se
  // varighetsvelger-JSX-en under). Begge nullstilles sammen, se tapSlot.
  const [duration, setDuration] = useState<BookingDurationMinutes | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  // Hover er kun en ekstra tydeliggjøring for pekerenheter som faktisk HAR
  // hover (mus) av akkurat DEN halvtimen man peker på – siden varigheten ikke
  // er valgt før man trykker, er det ingen "hel time" å forhåndsvise ved
  // museover lenger (i motsetning til tidligere). Sjekkes én gang (endrer seg
  // ikke i praksis).
  const [supportsHover] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches
  );
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);

  const [recurring, setRecurring] = useState(false);
  const [weeks, setWeeks] = useState(4);

  // Om gjentakende booking i det hele tatt er mulig fra den valgte
  // startdatoen (kun relevant i det sjeldne tilfellet at datoen ble valgt
  // FØR "Gjenta"-boksen ble huket av, og allerede ligger forbi klubbens
  // egen grense – se recurringCutoffDate i props) – og, uansett, det STØRSTE
  // antallet uker en rekke fra akkurat denne datoen har plass til innenfor
  // den grensen. Begge regnes ut her i UI-et SLIK AT man rett og slett ikke
  // kan velge flere uker enn det som er igjen, i stedet for å oppdage det
  // først i forhåndsvisningen (eller enda verre: etter betaling).
  const recurringAllowed = !recurringCutoffDate || date <= recurringCutoffDate;
  const maxWeeksAllowed = useMemo(
    () => maxRecurringWeeksUntil(date, recurringCutoffDate),
    [date, recurringCutoffDate]
  );

  // Skru av "gjentakende" igjen hvis datoen endres til noe forbi grensen
  // mens den står huket av, og hold "antall uker" innenfor det som faktisk
  // er lov fra den til enhver tid valgte datoen.
  useEffect(() => {
    if (recurring && !recurringAllowed) setRecurring(false);
  }, [recurring, recurringAllowed]);
  useEffect(() => {
    setWeeks((w) => Math.min(Math.max(1, maxWeeksAllowed), w));
  }, [maxWeeksAllowed]);

  const [preview, setPreview] = useState<RecurringPreviewResponse | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const [name, setName] = useState(() => readRemembered(REMEMBERED_NAME_KEY));
  const [phone, setPhone] = useState(() => readRemembered(REMEMBERED_PHONE_KEY));
  const [membershipConfirmed, setMembershipConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const phoneInputRef = useRef<HTMLInputElement | null>(null);
  // Blir true i det øyeblikket brukeren selv skriver noe i navnefeltet – da
  // skal IKKE telefonoppslaget under (eller den opprinnelige lokale
  // forhåndsutfyllingen) lenger få lov til å overskrive det brukeren selv
  // har skrevet inn.
  const userEditedNameRef = useRef(false);

  // Sann mens navn- eller telefonfeltet har fokus – da dytter det mobile
  // tastaturet seg opp fra bunnen, og den faste boksen (som også ligger i
  // bunnen av det synlige vinduet) ville ellers lagt seg oppå det i stedet
  // for bak. Se .floatingBarHidden i booking.module.css. Et lite tidsavbrudd
  // på selve "skjul igjen"-delen (ikke på "vis igjen") hindrer at boksen
  // blinker til synlig for et øyeblikk når man hopper rett fra navnefeltet
  // til telefonfeltet (blur på det ene rekker å skje før fokus på det neste).
  const [contactFieldFocused, setContactFieldFocused] = useState(false);
  const contactBlurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleContactFieldFocus() {
    if (contactBlurTimeoutRef.current) {
      clearTimeout(contactBlurTimeoutRef.current);
      contactBlurTimeoutRef.current = null;
    }
    setContactFieldFocused(true);
  }

  function handleContactFieldBlur() {
    if (contactBlurTimeoutRef.current) clearTimeout(contactBlurTimeoutRef.current);
    contactBlurTimeoutRef.current = setTimeout(() => setContactFieldFocused(false), 80);
  }

  useEffect(() => {
    return () => {
      if (contactBlurTimeoutRef.current) clearTimeout(contactBlurTimeoutRef.current);
    };
  }, []);

  // Husk navn/telefon i nettleseren fortløpende mens man skriver, slik at
  // neste besøk (eller neste booking rett etter) har feltene forhåndsutfylt.
  useEffect(() => {
    writeRemembered(REMEMBERED_NAME_KEY, name);
  }, [name]);
  useEffect(() => {
    writeRemembered(REMEMBERED_PHONE_KEY, phone);
  }, [phone]);

  // Gjenkjenner et mobilnummer som har blitt brukt i en TIDLIGERE booking –
  // også fra en helt annen nettleser/enhet enn den som huskes lokalt over –
  // og fyller inn navnet som ble brukt sist med akkurat dette nummeret. Kun
  // mens brukeren ikke selv har redigert navnefeltet (se userEditedNameRef),
  // slik at vi aldri overskriver noe brukeren bevisst har skrevet inn selv.
  useEffect(() => {
    const normalizedPhone = normalizeNorwegianMobile(phone);
    if (!normalizedPhone || userEditedNameRef.current) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      fetch(`/api/squash/customer-lookup?phone=${normalizedPhone}`, { signal: controller.signal })
        .then((res) => res.json() as Promise<{ name: string | null }>)
        .then((data) => {
          if (data.name && !userEditedNameRef.current) setName(data.name);
        })
        .catch(() => {
          // Stillegående – dette er kun en bekvemmelighet, aldri kritisk.
        });
    }, 400);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [phone]);

  // Oppdateres jevnlig slik at tidspunkter som akkurat passerte "nå" forsvinner
  // fra rutenettet uten at brukeren må laste siden på nytt.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Passerte klokkeslett vises ikke i det hele tatt (ikke bare gråes ut) –
  // rutenettet starter rett på det første tilgjengelige tidspunktet for i
  // dag, slik at man ikke må forholde seg til (eller scrolle forbi) en lang
  // rekke med tider som uansett aldri kan velges.
  const visibleSlots = useMemo(() => slots.filter((s) => !isPastStart(s, now)), [slots, now]);

  const selectedIndex = visibleSlots.findIndex((s) => s.label === selectedLabel);
  const canExtendSelectedToHour = selectedIndex >= 0 ? visibleSlots[selectedIndex].canExtendToHour : false;
  // Begge halvtimene vises kun sammenslått når kunden faktisk HAR valgt "1
  // time" (duration === 60) – før det er valgt (duration === null) er det
  // bare den ene halvtimen som venter på et svar, se "pending" i stateFor.
  const selectedSecondHalfIndex = duration === 60 ? secondHalfIndex(visibleSlots, selectedIndex) : -1;
  const hoveredIndex = supportsHover ? visibleSlots.findIndex((s) => s.label === hoveredLabel) : -1;
  const bookingEndLabel =
    selectedIndex >= 0 && duration !== null
      ? formatOslo(
          duration === 60 && selectedSecondHalfIndex >= 0
            ? visibleSlots[selectedSecondHalfIndex].endTime
            : visibleSlots[selectedIndex].endTime,
          "HH:mm"
        )
      : null;

  /**
   * Visuell tilstand for rutenett-slot `i` – avgjør både farge/klasse OG om
   * den skal flyte sammen med nabocellen (se useSlotMerging): "selected"
   * dekker BÅDE halvtimene når kunden har valgt "1 time" (ingen
   * fargeforskjell mellom dem lenger – de skal se ut som ÉN sammenhengende
   * blokk), "pending" er den ENE halvtimen kunden nettopp trykket på og som
   * venter på svar i varighetsvelgeren (lysere blå, aldri flere celler),
   * "hover" er forhåndsvisning ved museover av akkurat denne halvtimen,
   * "booked" er en halvtime som FYSISK overlapper en ekte booking (rødt,
   * flyter sammen med naboceller i samme tilstand – f.eks. en 2-timers
   * booking dekker 4 halvtimer).
   */
  function stateFor(i: number): SlotVisualState {
    const slot = visibleSlots[i];
    if (duration !== null && (i === selectedIndex || (selectedSecondHalfIndex >= 0 && i === selectedSecondHalfIndex))) {
      return "selected";
    }
    if (duration === null && i === selectedIndex) return "pending";
    if (i === hoveredIndex) return "hover";
    if (!slot.available) return "booked";
    return "normal";
  }

  const mergeSlots = useMemo(() => visibleSlots.map((s) => ({ startTime: s.startTime, key: s.label })), [visibleSlots]);
  const { containerRef, registerButtonRef, mergeLeft, mergeRight, bridges } = useSlotMerging(
    mergeSlots,
    (_mSlot, i) => stateFor(i),
    [selectedIndex, selectedSecondHalfIndex, duration, hoveredIndex]
  );

  // Hent ledige tider for valgt dag.
  useEffect(() => {
    const controller = new AbortController();
    setLoadingSlots(true);
    setSelectedLabel(null);
    setDuration(null);
    setErrorMessage(null);

    fetch(`/api/squash/availability?date=${date}`, { signal: controller.signal })
      .then((res) => res.json() as Promise<AvailabilityResponse>)
      .then((data) => {
        if (data.error) {
          setErrorMessage(data.error);
          setSlots([]);
          setClosedInfo(null);
        } else {
          setSlots(data.slots);
          setClosedInfo({ closed: !!data.closed, note: data.note ?? null });
        }
      })
      .catch((err) => {
        if (err?.name !== "AbortError") setErrorMessage("Kunne ikke hente ledige tider akkurat nå.");
      })
      .finally(() => setLoadingSlots(false));

    return () => controller.abort();
  }, [date, refreshToken]);

  // Forhåndsvis den gjentakende rekken når relevante felter endrer seg.
  useEffect(() => {
    if (!recurring || !selectedLabel || duration === null) {
      setPreview(null);
      return;
    }

    const controller = new AbortController();
    setLoadingPreview(true);

    const params = new URLSearchParams({
      date,
      time: selectedLabel,
      weeks: String(weeks),
      duration: String(duration),
    });

    fetch(`/api/squash/recurring-preview?${params.toString()}`, { signal: controller.signal })
      .then((res) => res.json() as Promise<RecurringPreviewResponse>)
      .then((data) => setPreview(data))
      .catch((err) => {
        if (err?.name !== "AbortError") setErrorMessage("Kunne ikke forhåndsvise ukene.");
      })
      .finally(() => setLoadingPreview(false));

    return () => controller.abort();
  }, [recurring, date, selectedLabel, weeks, duration]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedLabel || duration === null) return;
    if (!membershipConfirmed) return;
    if (recurring && preview && !preview.allAvailable) return;

    // Navn/telefon er IKKE en del av det Vipps-knappen krever for å være
    // klikkbar (se canStartPayment under) – i stedet fører et trykk på
    // knappen hit rett til feltet som mangler, i stedet for å gjøre ingenting.
    // Dette er nødvendig nå som knappen ligger i en fast boks og ikke lenger
    // rett ved siden av navn/telefon-feltene i skjemaet over.
    if (name.trim().length < 2) {
      nameInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      nameInputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (phone.trim().length === 0) {
      phoneInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      phoneInputRef.current?.focus({ preventScroll: true });
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/squash/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: recurring ? "recurring" : "single",
          date,
          time: selectedLabel,
          duration,
          weeks: recurring ? weeks : undefined,
          name,
          phone,
        }),
      });
      const data = (await res.json()) as { redirectUrl?: string; error?: string };

      if (!res.ok || !data.redirectUrl) {
        setErrorMessage(data.error ?? "Noe gikk galt. Prøv igjen.");
        if (res.status === 409) {
          setSelectedLabel(null);
          setPreview(null);
          setRefreshToken((n) => n + 1);
        }
        setSubmitting(false);
        return;
      }

      window.location.href = data.redirectUrl;
    } catch {
      setErrorMessage("Kunne ikke starte betaling. Sjekk internettforbindelsen og prøv igjen.");
      setSubmitting(false);
    }
  }

  /**
   * Trykk på et ledig klokkeslett i rutenettet. Trykker man på det ALLEREDE
   * valgte, FERDIG BEKREFTEDE klokkeslettet (duration er satt) igjen,
   * nullstilles hele valget – ellers blir dette det nye valgte klokkeslettet
   * og varighetsvelgeren åpnes på nytt (duration settes til null, uansett om
   * det var et helt nytt klokkeslett eller et som bare ventet på svar).
   */
  function tapSlot(slot: AvailabilitySlot) {
    if (!slot.available) return;
    if (slot.label === selectedLabel && duration !== null) {
      setSelectedLabel(null);
      setDuration(null);
      return;
    }
    setSelectedLabel(slot.label);
    setDuration(null);
  }

  const occurrenceCount = recurring ? weeks : 1;
  const priceForSelectedDuration = duration === 60 ? price60MinOre : duration === 30 ? price30MinOre : 0;
  const totalPrice = recurring && preview ? preview.totalAmountOre : priceForSelectedDuration * occurrenceCount;
  // Navn/telefon er BEVISST ikke med her – knappen skal forbli klikkbar selv
  // om de mangler, slik at et trykk på den tar deg til feltet som mangler
  // (se handleSubmit) i stedet for å virke "død". Medlemskap og valgt
  // varighet er fortsatt harde krav – varighet er en reell beslutning
  // brukeren selv må ta (se varighetsvelgeren under), ikke noe som kan
  // forhåndsutfylles.
  const canStartPayment =
    !!selectedLabel && duration !== null && membershipConfirmed && (!recurring || preview?.allAvailable);

  return (
    <>
      <div className={styles.card}>
        <div className={styles.dateRow}>
          <span className={styles.dateRowLabel}>{recurring ? "Første dato:" : "Velg dato:"}</span>
          <DatePicker
            value={date}
            onChange={setDate}
            minDate={today}
            maxDate={recurring ? (recurringCutoffDate ?? undefined) : maxDate}
          />
        </div>

        {loadingSlots && <p className={styles.emptyState}>Henter ledige tider …</p>}
        {!loadingSlots && slots.length === 0 && (
          <p className={styles.emptyState}>
            {closedInfo?.closed
              ? `Stengt denne dagen${closedInfo.note ? ` (${closedInfo.note})` : ""}.`
              : "Ingen bookbare tider denne dagen."}
          </p>
        )}
        {!loadingSlots && slots.length > 0 && visibleSlots.length === 0 && (
          <p className={styles.emptyState}>Ingen flere ledige tider i dag.</p>
        )}

        {!loadingSlots && visibleSlots.length > 0 && (
          <>
            <div className={styles.slotGrid} ref={containerRef}>
              {visibleSlots.map((slot, i) => {
                const bookable = isBookableSlot(visibleSlots, i);
                const state = stateFor(i);
                const classNames = [styles.slotButton];
                if (state === "selected") classNames.push(styles.slotButtonSelected);
                else if (state === "pending") classNames.push(styles.slotButtonPending);
                else if (state === "hover") classNames.push(styles.slotButtonHoverPreview);
                // Sammenhengende celler i SAMME tilstand (valgt time, eller en
                // ekte bookings egne halvtimer) flyter visuelt sammen til én
                // blokk – se useSlotMerging.
                if (mergeRight(slot.label)) classNames.push(styles.mergeRight);
                if (mergeLeft(slot.label)) classNames.push(styles.mergeLeft);
                return (
                  <button
                    key={slot.startTime}
                    ref={registerButtonRef(slot.label)}
                    type="button"
                    disabled={!bookable}
                    className={classNames.join(" ")}
                    onClick={() => tapSlot(slot)}
                    onMouseEnter={() => {
                      if (supportsHover && bookable) setHoveredLabel(slot.label);
                    }}
                    onMouseLeave={() => {
                      if (supportsHover) setHoveredLabel((current) => (current === slot.label ? null : current));
                    }}
                  >
                    {slot.label}
                  </button>
                );
              })}
              {bridges.map((bridge) => (
                <div
                  key={bridge.key}
                  aria-hidden
                  className={`${styles.slotBridge} ${
                    bridge.state === "selected"
                      ? styles.slotBridgeSelected
                      : bridge.state === "hover"
                        ? styles.slotBridgeHoverPreview
                        : bridge.state === "booked"
                          ? styles.slotBridgeBooked
                          : styles.slotBridgeBlocked
                  }`}
                  style={{ left: bridge.left, top: bridge.top, width: bridge.width, height: bridge.height }}
                />
              ))}
            </div>

            {selectedLabel && duration === null && selectedIndex >= 0 && (
              <div className={styles.durationPicker}>
                <p className={styles.durationPickerLabel}>Hvor lenge vil du booke kl. {selectedLabel}?</p>
                <div className={styles.durationPickerOptions}>
                  <button
                    type="button"
                    className={styles.durationOption}
                    onClick={() => setDuration(30)}
                  >
                    <span className={styles.durationOptionLabel}>{formatDurationMinutes(30)}</span>
                    <span className={styles.durationOptionPrice}>{formatPriceOre(price30MinOre)}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.durationOption}
                    disabled={!canExtendSelectedToHour}
                    onClick={() => canExtendSelectedToHour && setDuration(60)}
                    title={canExtendSelectedToHour ? undefined : "Den neste halvtimen er ikke ledig"}
                  >
                    <span className={styles.durationOptionLabel}>{formatDurationMinutes(60)}</span>
                    <span className={styles.durationOptionPrice}>{formatPriceOre(price60MinOre)}</span>
                  </button>
                </div>
              </div>
            )}

            {/*
             * Gjentakende booking hører tematisk sammen med selve
             * tid/varighet-valget over (det er jo DETTE tidspunktet/denne
             * varigheten som eventuelt skal gjentas) – ikke med navn/telefon
             * lenger nede, som er helt uavhengig av om bookingen gjentas
             * eller ikke. Vises derfor i SAMME boks som varighetsvelgeren,
             * rett etter at varighet er valgt (varighetsvelgeren over
             * forsvinner idet duration settes, så denne tar visuelt over
             * plassen i boksen).
             */}
            {selectedLabel && duration !== null && (
              <div className={styles.durationPicker}>
                <label className={styles.checkboxOption}>
                  <input
                    type="checkbox"
                    checked={recurring}
                    disabled={!recurringAllowed}
                    onChange={(e) => setRecurring(e.target.checked)}
                  />
                  Gjenta samme ukedag/klokkeslett hver uke
                </label>
                {!recurringAllowed && recurringCutoffDate && (
                  <p className={styles.subtitleText}>
                    Gjentakende booking er ikke mulig fra denne datoen – den er etter siste dato for gjentakende
                    bookinger ({formatOslo(recurringCutoffDate, "d. MMM yyyy")}).
                  </p>
                )}

                {recurring && (
                  <div className={styles.formRow} style={{ marginTop: 10 }}>
                    <label htmlFor="booking-weeks">Antall uker (inkl. denne)</label>
                    <input
                      id="booking-weeks"
                      type="number"
                      min={1}
                      max={maxWeeksAllowed}
                      value={weeks}
                      onChange={(e) => setWeeks(Math.max(1, Math.min(maxWeeksAllowed, Number(e.target.value) || 1)))}
                    />
                    {recurringCutoffDate && maxWeeksAllowed < MAX_RECURRING_WEEKS && (
                      <p className={styles.subtitleText}>
                        Du kan maks booke {maxWeeksAllowed} {maxWeeksAllowed === 1 ? "uke" : "uker"} fra denne datoen –
                        det er ikke mulig å booke etter {formatOslo(recurringCutoffDate, "d. MMM yyyy")} (siste dato
                        for gjentakende bookinger, satt av klubben).
                      </p>
                    )}

                    {loadingPreview && <p className={styles.emptyState}>Sjekker ledighet for alle ukene …</p>}

                    {!loadingPreview && preview && (
                      <div className={styles.previewList}>
                        {preview.occurrences.map((o) => (
                          <div
                            key={o.startTime}
                            className={o.available ? styles.previewRowOk : styles.previewRowConflict}
                          >
                            {formatOslo(o.startTime, "EEEE d. MMM")}
                            {" – "}
                            {o.available
                              ? "ledig"
                              : o.reason === "closed"
                                ? `stengt${o.note ? ` (${o.note})` : ""}`
                                : "opptatt"}
                          </div>
                        ))}
                        {!preview.allAvailable && (
                          <p className={styles.error}>
                            Én eller flere uker er opptatt eller stengt – juster antall uker eller klokkeslett.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <p className={styles.subtitleText}>
              Trykk på et ledig klokkeslett og velg om du vil booke 30 minutter eller 1 time. Grønt er ledig, rødt er
              fysisk opptatt (sammenhengende opptatte halvtimer flyter sammen til én blokk).
            </p>
          </>
        )}
      </div>

      {selectedLabel && duration !== null && (
        <form id="booking-form" className={`${styles.card} ${styles.form}`} onSubmit={handleSubmit} noValidate>
          <div className={styles.formRow}>
            <label>Du booker</label>
            <p className={styles.subtitleText}>
              {formatOslo(date, "EEEE d. MMMM")}, kl. {selectedLabel}
              {bookingEndLabel ? `–${bookingEndLabel}` : ""} ({formatDurationMinutes(duration)})
            </p>
          </div>

          <div className={styles.summary}>
            {recurring ? `${occurrenceCount} økter à` : "Totalt"} {formatPriceOre(priceForSelectedDuration)}
            {recurring && <> = {formatPriceOre(totalPrice)} totalt</>}
          </div>

          <div className={styles.formRow}>
            <label htmlFor="booking-name">Navn</label>
            <input
              ref={nameInputRef}
              id="booking-name"
              type="text"
              required
              minLength={2}
              maxLength={100}
              value={name}
              onChange={(e) => {
                userEditedNameRef.current = true;
                setName(e.target.value);
              }}
              onFocus={handleContactFieldFocus}
              onBlur={handleContactFieldBlur}
              autoComplete="name"
            />
          </div>

          <div className={styles.formRow}>
            <label htmlFor="booking-phone">Mobilnummer (Vipps)</label>
            <input
              ref={phoneInputRef}
              id="booking-phone"
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onFocus={handleContactFieldFocus}
              onBlur={handleContactFieldBlur}
              autoComplete="tel"
            />
            <p className={styles.subtitleText}>
              Har du booket før, gjenkjenner vi nummeret og fyller ut navnet for deg.
            </p>
          </div>

          {errorMessage && <p className={styles.error}>{errorMessage}</p>}
        </form>
      )}

      {/*
       * Medlemskapsbekreftelse og selve Vipps-knappen ligger i en egen,
       * fast boks (ikke inni <form> i DOM-treet) slik at den kan stå synlig
       * nederst i vinduet uansett hvor langt man har scrollet i resten av
       * skjemaet over – siden bak er fortsatt fullt scrollbar og klikkbar,
       * boksen legger seg bare oppå. Selve betalingen trigges likevel som en
       * ordentlig form-innsending via "form"-attributtet på knappen under,
       * som kobler den til <form id="booking-form"> uten at den må være et
       * barn av den i markup. På smale skjermer er boksen en full-bredde
       * linje nederst, på brede skjermer et lite flytende kort nede til
       * høyre – se .floatingBar / media query i booking.module.css.
       */}
      {selectedLabel && duration !== null && (
        <>
          <div
            className={`${styles.floatingBar} ${contactFieldFocused ? styles.floatingBarHidden : ""}`}
          >
            <div className={styles.floatingBarSummary}>
              <span className={styles.floatingBarPrice}>{formatPriceOre(totalPrice)}</span>
              <span className={styles.floatingBarMeta}>
                {formatOslo(date, "EEE d. MMM")}, kl. {selectedLabel}
                {bookingEndLabel ? `–${bookingEndLabel}` : ""}
              </span>
            </div>

            <label className={styles.floatingBarMembership}>
              <input
                type="checkbox"
                checked={membershipConfirmed}
                onChange={(e) => setMembershipConfirmed(e.target.checked)}
              />
              Jeg bekrefter at jeg har tilgang til banen gjennom medlemskap i Skiens Grane Squash eller Mova Skien.
            </label>

            <button
              type="submit"
              form="booking-form"
              className={styles.vippsButton}
              disabled={submitting || !canStartPayment}
            >
              {submitting ? (
                "Starter Vipps …"
              ) : (
                <>
                  Betal {formatPriceOre(totalPrice)} med
                  <img src="/vipps-logo.webp" alt="Vipps" className={styles.vippsLogo} />
                </>
              )}
            </button>
          </div>

          {/* Gir plass nederst slik at den faste boksen ikke dekker det
              siste innholdet i formen permanent når man scroller helt ned. */}
          <div className={styles.floatingBarSpacer} aria-hidden="true" />
        </>
      )}

      {!selectedLabel && errorMessage && (
        <div className={styles.card}>
          <p className={styles.error}>{errorMessage}</p>
        </div>
      )}
    </>
  );
}
