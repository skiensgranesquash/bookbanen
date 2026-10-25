"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import styles from "./booking.module.css";
import DatePicker from "./DatePicker";
import {
  BOOKING_DURATION_MINUTES,
  BOOKING_DURATION_SLOTS,
  MAX_RECURRING_WEEKS,
  PRICE_PER_SLOT_ORE,
  SLOT_LENGTH_MINUTES,
} from "@/lib/config";
import { maxBookableDate, todayInClubTimeZone } from "@/lib/slots";
import { formatDurationMinutes, formatOslo, formatPriceOre } from "@/lib/formatting";
import { normalizeNorwegianMobile } from "@/lib/phone";
import { useSlotMerging, type SlotVisualState } from "@/lib/useSlotMerging";

interface AvailabilitySlot {
  startTime: string;
  endTime: string;
  label: string;
  available: boolean;
  /** Kun satt når available er false. Se app/api/squash/availability/route.ts. */
  reason?: "booked" | "adjacent";
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
 * Om en gitt rutenett-slot er en ledig, bookbar hel time. Hver slot fra
 * /api/squash/availability dekker allerede nøyaktig BOOKING_DURATION_MINUTES
 * (se lib/slots.ts – generateSlotsForDate), så det holder å sjekke denne ene
 * slottens eget `available`-flagg – ingen oppslag av "neste" slot nødvendig.
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
}

export default function BookingCalendar({ recurringCutoffDate }: BookingCalendarProps) {
  const today = useMemo(() => todayInClubTimeZone(), []);
  const maxDate = useMemo(() => maxBookableDate(), []);

  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [closedInfo, setClosedInfo] = useState<{ closed: boolean; note: string | null } | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  // Hover-markering av "den andre halvtimen" er kun en ekstra tydeliggjøring
  // for pekerenheter som faktisk HAR hover (mus) – på mobil/touch er det ikke
  // noe konsept om å "holde over" noe før man trykker, så der er det den
  // faktiske VALGTE tiden (selectedLabel, satt ved tap) som alene driver
  // samme dobbel-markering. Sjekkes én gang (endrer seg ikke i praksis).
  const [supportsHover] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches
  );
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);

  const [recurring, setRecurring] = useState(false);
  const [weeks, setWeeks] = useState(4);

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
  const selectedSecondHalfIndex = secondHalfIndex(visibleSlots, selectedIndex);
  const hoveredIndex = supportsHover ? visibleSlots.findIndex((s) => s.label === hoveredLabel) : -1;
  const hoveredSecondHalfIndex = hoveredIndex >= 0 ? secondHalfIndex(visibleSlots, hoveredIndex) : -1;
  const bookingEndLabel =
    selectedIndex >= 0 && isBookableSlot(visibleSlots, selectedIndex)
      ? formatOslo(visibleSlots[selectedIndex].endTime, "HH:mm")
      : null;

  /**
   * Visuell tilstand for rutenett-slot `i` – avgjør både farge/klasse OG om
   * den skal flyte sammen med nabocellen (se useSlotMerging): "selected"
   * dekker BÅDE halvtimene i den valgte timen (ingen fargeforskjell mellom
   * dem lenger – de skal se ut som ÉN sammenhengende blokk), "hover" det
   * samme for forhåndsvisning ved museover, "booked" er en halvtime som
   * FYSISK overlapper en ekte booking (rødt, flyter sammen med naboceller i
   * samme tilstand – f.eks. en 2-timers booking dekker 4 halvtimer), og
   * "blocked" er en halvtime som kun er blokkert som starttidspunkt (grått –
   * passerte tidspunkter er allerede filtrert bort av visibleSlots over, så
   * denne tilstanden gjelder i praksis bare "adjacent").
   */
  function stateFor(i: number): SlotVisualState {
    const slot = visibleSlots[i];
    if (i === selectedIndex || (selectedSecondHalfIndex >= 0 && i === selectedSecondHalfIndex)) return "selected";
    if (i === hoveredIndex || (hoveredSecondHalfIndex >= 0 && i === hoveredSecondHalfIndex)) return "hover";
    if (!slot.available) return slot.reason === "booked" ? "booked" : "blocked";
    return "normal";
  }

  const mergeSlots = useMemo(() => visibleSlots.map((s) => ({ startTime: s.startTime, key: s.label })), [visibleSlots]);
  const { containerRef, registerButtonRef, mergeLeft, mergeRight, bridges } = useSlotMerging(
    mergeSlots,
    (_mSlot, i) => stateFor(i),
    [selectedIndex, selectedSecondHalfIndex, hoveredIndex, hoveredSecondHalfIndex]
  );

  // Hent ledige tider for valgt dag.
  useEffect(() => {
    const controller = new AbortController();
    setLoadingSlots(true);
    setSelectedLabel(null);
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
    if (!recurring || !selectedLabel) {
      setPreview(null);
      return;
    }

    const controller = new AbortController();
    setLoadingPreview(true);

    const params = new URLSearchParams({
      date,
      time: selectedLabel,
      weeks: String(weeks),
    });

    fetch(`/api/squash/recurring-preview?${params.toString()}`, { signal: controller.signal })
      .then((res) => res.json() as Promise<RecurringPreviewResponse>)
      .then((data) => setPreview(data))
      .catch((err) => {
        if (err?.name !== "AbortError") setErrorMessage("Kunne ikke forhåndsvise ukene.");
      })
      .finally(() => setLoadingPreview(false));

    return () => controller.abort();
  }, [recurring, date, selectedLabel, weeks]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedLabel) return;
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

  const occurrenceCount = recurring ? weeks : 1;
  const totalPrice =
    recurring && preview ? preview.totalAmountOre : PRICE_PER_SLOT_ORE * BOOKING_DURATION_SLOTS * occurrenceCount;
  // Navn/telefon er BEVISST ikke med her – knappen skal forbli klikkbar selv
  // om de mangler, slik at et trykk på den tar deg til feltet som mangler
  // (se handleSubmit) i stedet for å virke "død". Medlemskap er fortsatt et
  // hardt krav siden det er en bekreftelse brukeren selv må ha krysset av.
  const canStartPayment =
    !!selectedLabel && membershipConfirmed && (!recurring || preview?.allAvailable);

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
                else if (state === "hover") classNames.push(styles.slotButtonHoverPreview);
                // En halvtime som i seg selv er ledig, men der en ny hel time
                // ikke kan STARTE akkurat her uten å krysse inn i en
                // nabobooking, nedtones grått (se reason i
                // app/api/squash/availability/route.ts) – det er ikke noen
                // som faktisk har tatt akkurat denne halvtimen, i motsetning
                // til "booked" (rødt/gjennomstreket, fysisk opptatt).
                else if (state === "blocked") classNames.push(styles.slotButtonAdjacent);
                // Sammenhengende celler i SAMME tilstand (valgt time, hover-
                // forhåndsvisning, eller en ekte bookings egne halvtimer) flyter
                // visuelt sammen til én blokk – se useSlotMerging.
                if (mergeRight(slot.label)) classNames.push(styles.mergeRight);
                if (mergeLeft(slot.label)) classNames.push(styles.mergeLeft);
                return (
                  <button
                    key={slot.startTime}
                    ref={registerButtonRef(slot.label)}
                    type="button"
                    disabled={!bookable}
                    className={classNames.join(" ")}
                    onClick={() => setSelectedLabel(slot.label)}
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
            <p className={styles.subtitleText}>
              Hver booking varer {formatDurationMinutes(BOOKING_DURATION_MINUTES)} – velger du et klokkeslett flyter
              begge halvtimene sammen til én blokk, slik at det er tydelig at hele timen følger med. Grønt er ledig,
              rødt er fysisk opptatt (og flyter sammen på samme måte). Grått er at en hel time rett og slett ikke får
              plass her uten å krysse en annen økt.
            </p>
          </>
        )}
      </div>

      {selectedLabel && (
        <form id="booking-form" className={`${styles.card} ${styles.form}`} onSubmit={handleSubmit}>
          <div className={styles.formRow}>
            <label>Du booker</label>
            <p className={styles.subtitleText}>
              {formatOslo(date, "EEEE d. MMMM")}, kl. {selectedLabel}
              {bookingEndLabel ? `–${bookingEndLabel}` : ""} ({formatDurationMinutes(BOOKING_DURATION_MINUTES)})
            </p>
          </div>

          <div className={styles.formRow}>
            <label className={styles.checkboxOption}>
              <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
              Gjenta samme ukedag/klokkeslett hver uke
            </label>
          </div>

          {recurring && (
            <div className={styles.formRow}>
              <label htmlFor="booking-weeks">Antall uker (inkl. denne)</label>
              <input
                id="booking-weeks"
                type="number"
                min={1}
                max={MAX_RECURRING_WEEKS}
                value={weeks}
                onChange={(e) => setWeeks(Math.max(1, Math.min(MAX_RECURRING_WEEKS, Number(e.target.value) || 1)))}
              />

              {loadingPreview && <p className={styles.emptyState}>Sjekker ledighet for alle ukene …</p>}

              {!loadingPreview && preview && (
                <div className={styles.previewList}>
                  {preview.occurrences.map((o) => (
                    <div key={o.startTime} className={o.available ? styles.previewRowOk : styles.previewRowConflict}>
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

          <div className={styles.summary}>
            {recurring ? `${occurrenceCount} økter à` : "Totalt"} {formatPriceOre(PRICE_PER_SLOT_ORE * BOOKING_DURATION_SLOTS)}
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
      {selectedLabel && (
        <>
          <div className={styles.floatingBar}>
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
