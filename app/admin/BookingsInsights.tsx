"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  addDays,
  endOfMonth,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameDay,
  isWithinInterval,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { nb } from "date-fns/locale";
import styles from "./admin.module.css";
import { formatOslo } from "@/lib/formatting";
import { durationMinutesToSlots, MAX_RECURRING_WEEKS, SLOT_LENGTH_MINUTES } from "@/lib/config";
import { generateWeeklyDates, isWithinOpeningHours, occurrenceRange, todayInClubTimeZone } from "@/lib/slots";
import { useSlotMerging, type SlotVisualState } from "@/lib/useSlotMerging";
import { effectiveHoursForDate, type HoursContext } from "@/lib/openingHoursShared";
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
  /** Om akkurat DENNE fysiske halvtimen er ledig – se app/api/squash/availability/route.ts. */
  available: boolean;
  /** Kun satt når available er false. */
  reason?: "booked";
  /** Om en hel time kan starte akkurat her (begge halvtimene er ledige). */
  canExtendToHour: boolean;
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
  /** Sluttidspunkt ("HH:mm") for akkurat DENNE forekomsten – brukt til å vise et fra–til-klokkeslett for blokkeringer (se flattenOccurrences). */
  endTimeLabel: string;
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
  /** Satt kun for en turneringsbooking (se lib/settings/tournament.ts) – hvem kunden møter. Styrer den blå fargen i entryClassFor under. */
  opponentName: string | null;
  /** Faktisk varighet (minutter) på denne forekomsten – utledet fra slotten sitt eget start/slutt-tidspunkt, ikke en fast konstant, siden en booking nå kan være 30 min eller 1 time. */
  durationMinutes: number;
}

/** Flater ut alle bookinger til én rad PER faktisk tidsrom (en gjentakende booking har ett tidsrom per uke) – dette er enheten "en booking" regnes i overalt her, både i kalenderen og i statistikken/listen under. */
function flattenOccurrences(bookings: BookingRow[], includeStatuses: BookingRow["status"][]): Occurrence[] {
  const result: Occurrence[] = [];
  for (const booking of bookings) {
    if (!includeStatuses.includes(booking.status)) continue;
    for (const slot of booking.slots) {
      const dateStr = formatOslo(slot.startTime, "yyyy-MM-dd");
      const timeLabel = formatOslo(slot.startTime, "HH:mm");
      const endTimeLabel = formatOslo(slot.endTime, "HH:mm");
      const durationMinutes = Math.round(
        (new Date(slot.endTime).getTime() - new Date(slot.startTime).getTime()) / 60_000
      );
      const failed = booking.status === "cancelled" || booking.status === "expired";
      // En turneringsbooking (se lib/settings/tournament.ts) er ALDRI en
      // blokkering – kun en vanlig enkeltbooking som bare mangler betaling.
      const isTournamentMatch = booking.kind !== "block" && !!booking.opponentName;
      const shortText = booking.kind === "block"
        ? booking.note ?? "Blokkert"
        : isTournamentMatch
          ? `${booking.customerName} vs ${booking.opponentName}`
          : booking.customerName;
      // En "hele dagen"-blokkering (se app/api/admin/block/route.ts) lagres
      // fra 00:00 til 00:00 NESTE dag, altså 1440 minutter – da gir verken
      // "kl. 00:00" eller et fra–til-klokkeslett noen mening, så den får sin
      // egen tekst. En vanlig (klokkeslett-avgrenset) blokkering viser nå
      // fra–til i stedet for bare START-tidspunktet, siden f.eks. "15:08"
      // alene ikke forteller om den varer 10 minutter eller resten av dagen.
      const isWholeDayBlock = booking.kind === "block" && durationMinutes >= 1440;
      const label =
        booking.kind === "block"
          ? isWholeDayBlock
            ? `🔧 ${shortText} (hele dagen)`
            : `🔧 ${shortText} kl. ${timeLabel}–${endTimeLabel}`
          : `${shortText} kl. ${timeLabel}`;
      const statusClass = failed
        ? styles.bcEventLineFailed
        : booking.kind === "block"
          ? styles.bcEventLineBlock
          : isTournamentMatch
            ? styles.bcEventLineTournament
            : booking.status === "pending"
              ? styles.bcEventLinePending
              : "";

      result.push({
        id: booking.id,
        dateStr,
        timeLabel,
        endTimeLabel,
        label,
        failed,
        shortText,
        statusClass,
        status: booking.status,
        kind: booking.kind,
        customerName: booking.customerName,
        customerPhone: booking.customerPhone,
        opponentName: booking.opponentName ?? null,
        durationMinutes,
      });
    }
  }
  return result;
}

/** Hvilken CSS-klasse én enkelt oppføring i dag-ruten skal ha. Mislyktes (avlyst/utløpt) vinner alltid visuelt (rødt, gjennomstreket) – det er det viktigste å legge merke til. */
function entryClassFor(occ: Occurrence): string {
  if (occ.failed) return styles.bcEntryFailed;
  if (occ.kind === "block") return styles.bcEntryBlock;
  if (occ.opponentName) return styles.bcEntryTournament;
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
      /** Bookingens EGEN, eksisterende varighet (minutter) – styrer hvilke klokkeslett som er valgbare i slot-rutenettet under (se bookableForModal). */
      durationMinutes: number;
    };

interface BookingsInsightsProps {
  bookings: BookingRow[];
  /** Kalles etter at admin har booket, redigert eller avlyst en tid fra kalenderen/agenda-panelet, slik at AdminDashboard kan laste inn bookinger på nytt. */
  onChanged: () => void;
  /** Avlyser en booking (samme funksjon som brukes i bookinglisten nederst – viser bekreftelsesdialog og refunderer ved behov). */
  onCancel: (id: string, label: string) => Promise<void>;
  /**
   * Hele åpningstids-konteksten (ukentlig standard + alle
   * ferie/annerledesdag-unntak), hentet av AdminDashboard via
   * /api/admin/bookings/hours – brukes til å markere stengte dager med rødt
   * i kalenderen under, OG til å forhåndsvise en gjentakende rekkes datoer
   * FØR "Book rekken" trykkes. `null` mens den fortsatt lastes (eller hvis
   * hentingen mislyktes) – kalenderen viser da bare ingen rød markering,
   * uten å blokkere noe annet.
   */
  hoursContext: HoursContext | null;
}

/** Starten (mandag) på "inneværende uke" – basert på klubbens egen tidssone (samme kilde som selectedDate under), ikke nettleserens lokale klokke. */
function currentWeekStart(): Date {
  return startOfWeek(parseDateOnly(todayInClubTimeZone()), { weekStartsOn: 1 });
}

/** Antall uker kalenderen viser: inneværende uke + de 4 neste – et fast, ikke-bladbart vindu (ingen historikk), se BookingsInsights.tsx sin bruk av dette under. */
const CALENDAR_WEEKS = 5;

export default function BookingsInsights({ bookings, onChanged, onCancel, hoursContext }: BookingsInsightsProps) {
  const [selectedDate, setSelectedDate] = useState(() => todayInClubTimeZone());

  // Hvilken "side" av det faste CALENDAR_WEEKS-vinduet som vises - 0 er
  // inneværende uke (standard ved hver innlasting). Admin kan bla fremover
  // for å se/administrere gjentakende bookinger som strekker seg lenger fram
  // enn standardvisningen (kunder kan booke serier opptil MAX_RECURRING_WEEKS
  // uker fram i tid - se maxWindowPage under), og bla tilbake igjen til
  // inneværende uke, men ikke lenger tilbake enn det (admin trenger ikke se
  // historikk her - bookingslisten nederst har all historikk uansett).
  const [windowPage, setWindowPage] = useState(0);

  const [modal, setModal] = useState<ModalState | null>(null);
  const [manualTime, setManualTime] = useState("");
  // Varighet for en NY manuell booking (kun relevant i "create"-modus – en
  // redigering beholder alltid bookingens egen, opprinnelige varighet, se
  // modalDurationMinutes under). 60 min er fortsatt forhåndsvalgt, akkurat
  // som før dette ble valgbart.
  const [manualDurationMinutes, setManualDurationMinutes] = useState<30 | 60>(60);
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  // Gjentakende booking (kun relevant i "create"-modus – en redigering har
  // alltid kun ett eksisterende tidsrom å flytte, se modal.kind over) – samme
  // ukedag/klokkeslett hver uke fra og med modal.date, se
  // app/api/admin/bookings/manual/route.ts.
  const [manualRecurring, setManualRecurring] = useState(false);
  const [manualWeeks, setManualWeeks] = useState(4);
  // Betalingsmåte for en NY manuell booking (kun relevant i "create"-modus) –
  // se durationToggle-aktige knappene i modalen under, og
  // app/api/admin/bookings/manual/route.ts for selve logikken bak de to
  // modiene.
  const [manualRequestPayment, setManualRequestPayment] = useState(false);
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

  // Blokkering av tid - ÉN boks der admin velger om det gjelder én dag
  // (alltid `selectedDate`, dagen som er klikket i kalenderen over) eller
  // flere dager på rad (samme klokkeslett - eller hele dagen - hver dag i
  // rekken fra og med `selectedDate`), og om det gjelder hele dagen eller et
  // valgt klokkeslett. Var tidligere to separate skjemaer (ett for rask
  // blokkering av én dag, ett for flere dager på rad); nå er det ett
  // skjema, med et valg for omfang øverst i stedet.
  const [blockScope, setBlockScope] = useState<"single" | "range">("single");
  const [blockToDate, setBlockToDate] = useState("");
  const [blockWholeDay, setBlockWholeDay] = useState(true);
  const [blockStart, setBlockStart] = useState("");
  const [blockEnd, setBlockEnd] = useState("");
  const [blockNote, setBlockNote] = useState("");
  const [blockSubmitting, setBlockSubmitting] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

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

  // Admin sin manuelle booking har samme to valg som en vanlig booking (30
  // min eller 1 time, se durationToggle-knappene i modalen under) når man
  // OPPRETTER en ny (se app/api/admin/bookings/manual/route.ts) – men når
  // man REDIGERER en eksisterende booking sitt klokkeslett, beholdes
  // bookingens EGEN, opprinnelige varighet (se
  // app/api/admin/bookings/[id]/route.ts) i stedet, så rutenettet må vite
  // hvilken av de to det gjelder, både for hvilke celler som er valgbare OG
  // om valget skal vises som én eller to sammenslåtte halvtimer.
  const modalDurationMinutes = modal === null ? 60 : modal.mode === "create" ? manualDurationMinutes : modal.durationMinutes;

  const manualSelectedIndex = manualTime ? effectiveModalSlots.findIndex((s) => s.label === manualTime) : -1;
  const manualSelectedSecondHalf =
    modalDurationMinutes === 60 ? secondHalfIndex(effectiveModalSlots, manualSelectedIndex) : -1;
  const manualHoveredIndex = supportsHover
    ? effectiveModalSlots.findIndex((s) => s.label === hoveredManualTime)
    : -1;
  const manualHoveredSecondHalf =
    modalDurationMinutes === 60 && manualHoveredIndex >= 0 ? secondHalfIndex(effectiveModalSlots, manualHoveredIndex) : -1;

  /** Om en gitt rutenett-halvtime faktisk kan velges for DENNE modalens varighet. */
  function bookableForModal(slot: AvailabilitySlot): boolean {
    if (!slot.available) return false;
    return modalDurationMinutes <= 30 || slot.canExtendToHour;
  }

  function manualStateFor(i: number): SlotVisualState {
    const slot = effectiveModalSlots[i];
    if (i === manualSelectedIndex || (manualSelectedSecondHalf >= 0 && i === manualSelectedSecondHalf)) return "selected";
    if (i === manualHoveredIndex || (manualHoveredSecondHalf >= 0 && i === manualHoveredSecondHalf)) return "hover";
    if (!slot.available) return "booked";
    if (!bookableForModal(slot)) return "blocked";
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
    const isToday = modal.date === todayInClubTimeZone();

    fetch(`/api/squash/availability?date=${modal.date}`, { signal: controller.signal })
      .then((res) => res.json() as Promise<{ slots?: AvailabilitySlot[] }>)
      .then((data) => {
        const slots = data.slots ?? [];
        // Samme som den offentlige bookingsiden (se BookingCalendar.tsx):
        // admin trenger ikke se tidspunkt som allerede har passert i dag –
        // kun aktuelt for DAGENS dato, ikke tidligere dager (der skal hele
        // rutenettet fortsatt vises som før, f.eks. ved redigering av en
        // gammel enkeltbooking).
        setModalSlots(isToday ? slots.filter((s) => new Date(s.startTime).getTime() > Date.now()) : slots);
      })
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
  // En FJERNET blokkering (status "cancelled" – se handleAgendaCancel/onCancel
  // under) skal bare forsvinne helt, ikke vises gjennomstreket slik en ekte
  // avlyst/utløpt KUNDEbooking gjør – den historikken er nyttig for kunder,
  // men ikke for admin sine egne blokkeringer. Filtreres derfor bort her, ETT
  // sted, slik at den uansett ikke dukker opp verken i kalenderen eller i
  // agenda-panelet ved siden av.
  const calendarOccurrences = useMemo(
    () =>
      flattenOccurrences(bookings, ["pending", "confirmed", "cancelled", "expired"]).filter(
        (occ) => !(occ.kind === "block" && occ.failed)
      ),
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

  // Vindu på CALENDAR_WEEKS uker, med inneværende uke (windowPage 0) som
  // standard - forskyver seg automatisk fremover etter hvert som dagene
  // passerer, siden det alltid regnes ut fra dagens dato på nytt ved hver
  // rendring. Admin kan bla videre i hele CALENDAR_WEEKS-sider via
  // windowPage, opptil maxWindowPage (se Forrige/Neste-knappene under) -
  // det dekker hele spennet en gjentakende bookingserie kan nå
  // (MAX_RECURRING_WEEKS), siden kunder ellers kunne booke uker admin ikke
  // hadde noen måte å se eller administrere fra denne kalenderen.
  const maxWindowPage = Math.max(0, Math.floor((MAX_RECURRING_WEEKS - 1) / CALENDAR_WEEKS));
  const windowStart = addDays(currentWeekStart(), windowPage * CALENDAR_WEEKS * 7);
  const windowEnd = addDays(windowStart, CALENDAR_WEEKS * 7 - 1);
  const days = eachDayOfInterval({ start: windowStart, end: windowEnd });
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Overskrift over kalenderen: datospenn. Skriver ALLTID ut måneden på
  // BEGGE ender når vinduet krysser et eller flere månedsskifter (f.eks.
  // "27. okt – 30. nov 2026"), slik at det er umulig å overse – se også
  // bcDayAltMonth/bcDayMonthStart-markeringen på selve dag-rutene under.
  const sameMonth = format(windowStart, "LLLL yyyy", { locale: nb }) === format(windowEnd, "LLLL yyyy", { locale: nb });
  const weekRangeLabel = sameMonth
    ? `${format(windowStart, "d.", { locale: nb })}–${format(windowEnd, "d. MMMM yyyy", { locale: nb })}`
    : `${format(windowStart, "d. MMM", { locale: nb })} – ${format(windowEnd, "d. MMM yyyy", { locale: nb })}`;

  function openCreateModal(dateStr: string) {
    setModal({ mode: "create", date: dateStr });
    setManualTime("");
    setManualDurationMinutes(60);
    setManualName("");
    setManualPhone("");
    setManualRecurring(false);
    setManualWeeks(4);
    setManualRequestPayment(false);
    setManualError(null);
  }

  function openEditModal(occ: Occurrence) {
    setModal({
      mode: "edit",
      id: occ.id,
      date: occ.dateStr,
      kind: occ.kind,
      label: occ.label,
      status: occ.status,
      durationMinutes: occ.durationMinutes,
    });
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

  async function handleBlockSubmit(e: FormEvent) {
    e.preventDefault();
    setBlockSubmitting(true);
    setBlockError(null);
    const err = await submitBlock({
      fromDate: selectedDate,
      toDate: blockScope === "range" ? blockToDate || selectedDate : selectedDate,
      wholeDay: blockWholeDay,
      startTime: blockWholeDay ? undefined : blockStart,
      endTime: blockWholeDay ? undefined : blockEnd,
      note: blockNote,
    });
    setBlockSubmitting(false);
    if (err) {
      setBlockError(err);
      return;
    }
    setBlockScope("single");
    setBlockToDate("");
    setBlockWholeDay(true);
    setBlockStart("");
    setBlockEnd("");
    setBlockNote("");
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
          body: JSON.stringify({
            date: modal.date,
            time: manualTime,
            name: manualName,
            phone: manualPhone,
            durationMinutes: manualDurationMinutes,
            weeks: manualRecurring ? manualWeeks : 1,
            requestPayment: manualRequestPayment,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; redirectUrl?: string };
        if (!res.ok) {
          setManualError(
            data.error ?? (manualRequestPayment ? "Kunne ikke sende betalingsforespørsel." : "Kunne ikke booke tiden.")
          );
          return;
        }
        // Kun satt i mock/testmodus (se app/api/admin/bookings/manual/route.ts)
        // – en lenke dere selv kan åpne for å simulere kundens godkjenning,
        // siden det ikke finnes noen ekte telefon å sende et push-varsel til
        // i testmodus.
        if (manualRequestPayment && data.redirectUrl) {
          window.alert(
            `Betalingsforespørsel sendt. Testlenke (kun i simulert/test-modus – ignorer i ekte Vipps-modus): ${data.redirectUrl}`
          );
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
          ? manualRequestPayment
            ? "Kunne ikke sende betalingsforespørsel akkurat nå."
            : "Kunne ikke booke tiden akkurat nå."
          : modal.status === "cancelled"
            ? "Kunne ikke aktivere bookingen på nytt akkurat nå."
            : "Kunne ikke lagre endringen akkurat nå."
      );
    } finally {
      setManualSubmitting(false);
    }
  }

  // Forhåndsviser de FAKTISKE datoene en gjentakende rekke ville dekket, og
  // flagger hvilke av dem som er stengt (ukedagens standard, eller en
  // "ferie/annerledesdag"-unntak) – FØR admin trykker "Book rekken", i
  // stedet for å måtte trykke og få en feilmelding for å finne det ut (se
  // app/api/admin/bookings/manual/route.ts, som avviser HELE rekken hvis ÉN
  // eneste dato er stengt). Ren klient-side utregning fra den allerede
  // innhentede HoursContext – ingen eget nettverkskall, samme mønster som
  // den offentlige bookingsiden sin egen /api/squash/recurring-preview (se
  // app/BookingCalendar.tsx), men uten den selvbetjenings-grensen
  // (recurringCutoffDate) admin selv er unntatt fra.
  const recurringSeriesPreview =
    modal !== null && modal.mode === "create" && manualRecurring && manualTime && hoursContext
      ? generateWeeklyDates(modal.date, manualWeeks).map((date) => {
          const durationSlots = durationMinutesToSlots(manualDurationMinutes);
          const range = occurrenceRange(date, manualTime, durationSlots);
          const hours = effectiveHoursForDate(date, hoursContext);
          const closed = !range || !isWithinOpeningHours(range.startTime, range.endTime, hours);
          return { date, closed, note: hours.note };
        })
      : null;
  const recurringSeriesHasClosedDay = recurringSeriesPreview?.some((o) => o.closed) ?? false;

  const submitDisabled =
    manualSubmitting ||
    (needsSlotGrid && !manualTime) ||
    (modal !== null && modal.mode === "create" && manualRecurring && recurringSeriesHasClosedDay) ||
    (modal !== null && modal.mode === "create" && manualRequestPayment && !manualPhone.trim());

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
              onClick={() => setWindowPage((p) => Math.max(0, p - 1))}
              disabled={windowPage <= 0}
              aria-label="Forrige periode"
            >
              ‹
            </button>
            <span className={styles.calTitle}>{weekRangeLabel}</span>
            <button
              type="button"
              className={styles.calNav}
              onClick={() => setWindowPage((p) => Math.min(maxWindowPage, p + 1))}
              disabled={windowPage >= maxWindowPage}
              aria-label="Neste periode"
            >
              ›
            </button>
          </div>
          {windowPage > 0 && (
            <div style={{ textAlign: "center", marginBottom: 6 }}>
              <button type="button" className={styles.linkButton} onClick={() => setWindowPage(0)}>
                Tilbake til i dag
              </button>
            </div>
          )}

          <div className={styles.calWeekdays}>
            {CAL_WEEKDAY_HEADERS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>

          <div className={styles.bcGrid}>
            {days.map((day, dayIndex) => {
              const dateStr = toDateString(day);
              const isPastDay = day.getTime() < today.getTime();
              const isToday = isSameDay(day, today);
              const isSelected = dateStr === selectedDate;
              const dayOccurrences = occurrencesByDate.get(dateStr) ?? [];
              // En "hele dagen"-blokkering dekker (se kommentaren i
              // flattenOccurrences over) fra 00:00 til 00:00 neste dag – i
              // stedet for å vise den som en forvirrende "00:00 ..."-lapp
              // blant de andre oppføringene, farges HELE dag-ruten rød (se
              // bcDayBlocked under) og selve lappen utelates fra listen –
              // cellens egen farge forteller allerede at dagen er full.
              const wholeDayBlocks = dayOccurrences.filter((o) => o.kind === "block" && o.durationMinutes >= 1440);
              const isWholeDayBlocked = wholeDayBlocks.length > 0;
              const pillOccurrences = isWholeDayBlocked
                ? dayOccurrences.filter((o) => !(o.kind === "block" && o.durationMinutes >= 1440))
                : dayOccurrences;
              const { visible, hiddenCount } = pickVisibleForDay(pillOccurrences);
              // Måneden vises i tillegg til datotallet på vinduets første dag
              // (for å alltid vite hvilken måned det starter i) OG på den 1.
              // i måneden uansett hvor den faller – det er nettopp DER et
              // månedsskifte skjer, så det stedet skal alltid være tydelig,
              // ikke bare i overskriften over.
              const showMonth = dayIndex === 0 || day.getDate() === 1;
              // Månedsskifte-markering: annenhver måned i vinduet får en svakt
              // avvikende bakgrunn (ALDRI nedtonet/skjult – kun en annen
              // nyanse), og selve 1.-dagen i en ny måned får i tillegg en
              // tydelig kantlinje, slik at de to månedene fremstår som
              // adskilte grupper av dager uten at noe gjemmes bort.
              const monthsFromStart =
                (day.getFullYear() - windowStart.getFullYear()) * 12 + (day.getMonth() - windowStart.getMonth());
              const altMonth = monthsFromStart % 2 === 1;
              const isMonthStart = dayIndex > 0 && day.getDate() === 1;

              // Stengt denne dagen (ukedagens standard, eller en
              // "ferie/annerledesdag"-unntak) – ren, synkron utregning fra
              // den allerede innhentede HoursContext (se
              // app/api/admin/bookings/hours/route.ts), ingen nettverkskall
              // per dag. `hoursContext` er null helt til den første hentingen
              // er ferdig (eller hvis den mislyktes) – da vises bare ingen
              // rød markering, som før denne funksjonen fantes.
              const isClosedDay = hoursContext ? effectiveHoursForDate(dateStr, hoursContext).closed : false;

              const classNames = [styles.bcDay];
              if (altMonth) classNames.push(styles.bcDayAltMonth);
              if (isMonthStart) classNames.push(styles.bcDayMonthStart);
              if (isClosedDay) classNames.push(styles.bcDayClosed);
              if (isWholeDayBlocked) classNames.push(styles.bcDayBlocked);
              if (isPastDay) classNames.push(styles.bcDayPast);
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
                    <span className={styles.bcDayNumber}>
                      {showMonth ? format(day, "d. MMM", { locale: nb }) : day.getDate()}
                    </span>
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
                          {occ.kind === "block" ? `${occ.timeLabel}–${occ.endTimeLabel}` : occ.timeLabel} {occ.shortText}
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
              <span className={styles.calLegendDot} style={{ background: "var(--tournament-dark)" }} />
              Turneringskamp
            </span>
            <span>
              <span className={styles.calLegendDot} style={{ background: "#854d0e" }} />
              Venter på betaling
            </span>
            <span>
              <span className={styles.calLegendDot} style={{ background: "var(--danger-dark)" }} />
              Blokkert
            </span>
            <span>
              <span className={styles.calLegendDot} style={{ background: "var(--danger-dark)" }} />
              Mislyktes (avlyst/utløpt)
            </span>
            <span>
              <span className={styles.calLegendDot} style={{ background: "var(--danger-dark)" }} />
              Stengt
            </span>
          </div>

          <form onSubmit={handleBlockSubmit} className={styles.blockStrip}>
            <div className={styles.blockStripTitle}>
              Blokker{" "}
              {blockScope === "single"
                ? format(parseDateOnly(selectedDate), "EEEE d. MMMM", { locale: nb })
                : "flere dager på rad"}
            </div>

            <div className={styles.durationToggle} style={{ marginBottom: 10 }}>
              <button
                type="button"
                className={`${styles.durationToggleButton} ${
                  blockScope === "single" ? styles.durationToggleButtonActive : ""
                }`}
                onClick={() => setBlockScope("single")}
              >
                Én dag
              </button>
              <button
                type="button"
                className={`${styles.durationToggleButton} ${
                  blockScope === "range" ? styles.durationToggleButtonActive : ""
                }`}
                onClick={() => setBlockScope("range")}
              >
                Flere dager på rad
              </button>
            </div>

            <div className={styles.inlineFields}>
              {blockScope === "range" && (
                <div>
                  <label htmlFor="block-to">
                    Fra {format(parseDateOnly(selectedDate), "d. MMM", { locale: nb })} til og med
                  </label>
                  <input
                    id="block-to"
                    type="date"
                    required
                    value={blockToDate}
                    min={selectedDate}
                    onChange={(e) => setBlockToDate(e.target.value)}
                  />
                </div>
              )}
              <div>
                <label
                  className={styles.checkboxOption}
                  style={{ marginTop: blockScope === "range" ? "20px" : 0 }}
                >
                  <input
                    type="checkbox"
                    checked={blockWholeDay}
                    onChange={(e) => setBlockWholeDay(e.target.checked)}
                  />
                  Hele dagen
                </label>
              </div>
              {!blockWholeDay && (
                <>
                  <div>
                    <label htmlFor="block-start">Fra kl.</label>
                    <input
                      id="block-start"
                      type="time"
                      value={blockStart}
                      onChange={(e) => setBlockStart(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="block-end">Til kl.</label>
                    <input
                      id="block-end"
                      type="time"
                      value={blockEnd}
                      onChange={(e) => setBlockEnd(e.target.value)}
                    />
                  </div>
                </>
              )}
              <div>
                <label htmlFor="block-note">Forklaring</label>
                <input
                  id="block-note"
                  type="text"
                  maxLength={200}
                  value={blockNote}
                  onChange={(e) => setBlockNote(e.target.value)}
                  placeholder="F.eks. vedlikehold, turnering …"
                />
              </div>
            </div>
            {blockError && <p className={styles.error}>{blockError}</p>}
            <button
              type="submit"
              className={styles.submitButton}
              disabled={
                blockSubmitting ||
                !blockNote.trim() ||
                (!blockWholeDay && (!blockStart || !blockEnd)) ||
                (blockScope === "range" && !blockToDate)
              }
            >
              {blockSubmitting ? "Blokkerer …" : blockScope === "range" ? "Blokker dagene" : "Blokker dagen"}
            </button>
          </form>
        </div>

        <div className={styles.agendaPanel}>
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
              {modal.mode === "create"
                ? manualRequestPayment
                  ? "Be om betaling (Vipps)"
                  : "Book uten betaling"
                : modal.status === "cancelled"
                  ? "Aktiver booking på nytt"
                  : "Rediger booking"}{" "}
              –{" "}
              {format(parseDateOnly(modal.date), "EEEE d. MMMM", { locale: nb })}
            </h3>
            <p className={styles.bookingMeta}>
              {modal.mode === "create"
                ? manualRequestPayment
                  ? "Det sendes en betalingsforespørsel til telefonnummeret under via Vipps. Bookingen blir først bindende når kunden har godkjent/betalt."
                  : "Bookingen er bekreftet med en gang, uten Vipps."
                : modal.status === "cancelled"
                  ? modal.kind === "single"
                    ? "Denne tiden er avlyst. Lagre for å aktivere den igjen – velg et annet klokkeslett hvis det opprinnelige er opptatt av noen andre nå."
                    : "Denne rekken er avlyst. Lagre for å aktivere den igjen (klokkeslettene kan ikke endres her)."
                  : modal.kind === "single"
                    ? "Velg et nytt klokkeslett, eller la det stå som det er."
                    : "Klokkeslett kan ikke endres her for gjentakende bookinger eller blokkeringer – kun navn/telefon."}
            </p>

            {modal.mode === "create" && (
              <div className={styles.durationToggle}>
                <button
                  type="button"
                  className={`${styles.durationToggleButton} ${
                    manualDurationMinutes === 30 ? styles.durationToggleButtonActive : ""
                  }`}
                  onClick={() => {
                    setManualDurationMinutes(30);
                    setManualTime("");
                  }}
                >
                  30 min
                </button>
                <button
                  type="button"
                  className={`${styles.durationToggleButton} ${
                    manualDurationMinutes === 60 ? styles.durationToggleButtonActive : ""
                  }`}
                  onClick={() => {
                    setManualDurationMinutes(60);
                    setManualTime("");
                  }}
                >
                  1 time
                </button>
              </div>
            )}

            {modal.mode === "create" && (
              <div className={styles.durationToggle} style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className={`${styles.durationToggleButton} ${
                    !manualRequestPayment ? styles.durationToggleButtonActive : ""
                  }`}
                  onClick={() => setManualRequestPayment(false)}
                >
                  Book uten betaling
                </button>
                <button
                  type="button"
                  className={`${styles.durationToggleButton} ${
                    manualRequestPayment ? styles.durationToggleButtonActive : ""
                  }`}
                  onClick={() => setManualRequestPayment(true)}
                >
                  Be om betaling (Vipps)
                </button>
              </div>
            )}

            {modal.mode === "create" && (
              <div style={{ marginTop: 10 }}>
                <label className={styles.checkboxOption}>
                  <input
                    type="checkbox"
                    checked={manualRecurring}
                    onChange={(e) => setManualRecurring(e.target.checked)}
                  />
                  Gjentakende – samme ukedag/klokkeslett hver uke
                </label>
                {manualRecurring && (
                  <div className={styles.formRow} style={{ marginTop: 10 }}>
                    <label htmlFor="manual-weeks">Antall uker (inkl. denne)</label>
                    <input
                      id="manual-weeks"
                      type="number"
                      min={1}
                      max={MAX_RECURRING_WEEKS}
                      value={manualWeeks}
                      onChange={(e) =>
                        setManualWeeks(Math.max(1, Math.min(MAX_RECURRING_WEEKS, Number(e.target.value) || 1)))
                      }
                    />
                    {recurringSeriesPreview && (
                      <div className={styles.previewList}>
                        {recurringSeriesPreview.map((o) => (
                          <div key={o.date} className={o.closed ? styles.previewRowConflict : styles.previewRowOk}>
                            {format(parseDateOnly(o.date), "EEEE d. MMM", { locale: nb })}
                            {" – "}
                            {o.closed ? `stengt${o.note ? ` (${o.note})` : ""}` : "åpent"}
                          </div>
                        ))}
                        {recurringSeriesHasClosedDay && (
                          <p className={styles.error}>
                            Én eller flere datoer i rekken er stengt – hele rekken kan ikke bookes før klokkeslett
                            eller antall uker er justert.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

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
                      const disabled = !bookableForModal(slot) && !isSelected;
                      const state = manualStateFor(i);
                      const classNames = [styles.manualSlotButton];
                      // "blocked" (grått) = fysisk ledig halvtime, men ikke
                      // nok plass til DENNE modalens varighet (vanligvis fordi
                      // en hel time ikke får plass her) – samme skille som den
                      // offentlige bookingsiden sitt canExtendToHour-flagg (se
                      // app/api/squash/availability/route.ts).
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
                <label htmlFor="manual-phone">
                  {modal.mode === "create" && manualRequestPayment
                    ? "Telefon (påkrevd for betalingsforespørsel)"
                    : "Telefon (valgfritt)"}
                </label>
                <input
                  id="manual-phone"
                  type="tel"
                  required={modal.mode === "create" && manualRequestPayment}
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
                      ? manualRequestPayment
                        ? manualRecurring
                          ? "Send betalingsforespørsel (rekke)"
                          : "Send betalingsforespørsel"
                        : manualRecurring
                          ? "Book rekken"
                          : "Book tiden"
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
