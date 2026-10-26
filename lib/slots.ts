import { addDays, addMinutes } from "date-fns";
import { format, fromZonedTime } from "date-fns-tz";
import { MAX_DAYS_AHEAD, MAX_RECURRING_WEEKS, SLOT_LENGTH_MINUTES, TIME_ZONE } from "./config";

export interface SlotDefinition {
  /** UTC-tidspunkt økten starter. */
  startTime: Date;
  /** UTC-tidspunkt økten slutter (kun denne ene timeluken – ikke hele en flertimersøkt). */
  endTime: Date;
  /** Lesbart klokkeslett i lokal tid, f.eks. "14:00". */
  label: string;
}

export function isValidBookingDateString(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const asDate = new Date(Date.UTC(y, m - 1, d));
  return asDate.getUTCFullYear() === y && asDate.getUTCMonth() === m - 1 && asDate.getUTCDate() === d;
}

/** Dagens dato i klubbens tidssone, som "YYYY-MM-DD". */
export function todayInClubTimeZone(): string {
  return format(new Date(), "yyyy-MM-dd", { timeZone: TIME_ZONE });
}

/** Siste dato man har lov til å booke en enkelttime, som "YYYY-MM-DD". */
export function maxBookableDate(): string {
  return format(addDays(new Date(), MAX_DAYS_AHEAD), "yyyy-MM-dd", { timeZone: TIME_ZONE });
}

/** Om en dato er innenfor vinduet man har lov til å booke en enkelttime. */
export function isDateBookable(dateStr: string): boolean {
  if (!isValidBookingDateString(dateStr)) return false;
  return dateStr >= todayInClubTimeZone() && dateStr <= maxBookableDate();
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function timeStringToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export interface OpeningInterval {
  /** "HH:mm". */
  open: string;
  /** "HH:mm". */
  close: string;
}

/**
 * Genererer alle bookbare STARTtidspunkter (hver hele/halve time, dvs. hvert
 * SLOT_LENGTH_MINUTES) for én kalenderdag, i klubbens tidssone, gitt den
 * dagens EFFEKTIVE åpningstider (se lib/settings/openingHours.ts – ukedagens
 * standard, eller en "ferie/annerledesdag"-unntak hvis dagen har et slikt).
 *
 * En dag kan ha FLERE tidsrom (f.eks. 05:00–11:00 og 12:00–17:00, lunsjstengt
 * midt på) – hvert tidsrom genererer sine starttidspunkter HELT UAVHENGIG av
 * de andre, så rutenettet får naturlig et "hull" der det ikke er åpent (ingen
 * booking kan starte slik at den ville krysset pausen mellom to tidsrom).
 *
 * Genererer KUN starttidspunkter der en hel SLOT_LENGTH_MINUTES-lang
 * tidsluke faktisk får plass før tidsrommets stengetid – et siste
 * starttidspunkt som ikke rekker en hel halvtime før stengetid vises aldri
 * (ikke bare gråes ut).
 *
 * VIKTIG: hver returnert slot er en REN, fysisk SLOT_LENGTH_MINUTES-lang
 * tidsluke (`endTime` = start + SLOT_LENGTH_MINUTES, ALDRI lenger) – siden
 * en booking nå kan være enten 30 minutter eller 1 time (se
 * BOOKABLE_DURATIONS_MINUTES i lib/config.ts), kan ikke denne funksjonen
 * lenger bake inn en fast varighet i selve rutenettet. Hvert "slot" her er
 * dermed alltid den minste bookbare enheten; om en hel time faktisk kan
 * starte her avgjøres av KALLEREN ved å se på om påfølgende tidsluke også er
 * ledig (se `canExtendToHour` i app/api/squash/availability/route.ts).
 */
export function generateSlotsForDate(dateStr: string, intervals: OpeningInterval[]): SlotDefinition[] {
  const slots: SlotDefinition[] = [];

  for (const interval of intervals) {
    const openMinutes = timeStringToMinutes(interval.open);
    const closeMinutes = timeStringToMinutes(interval.close);

    for (
      let minuteOfDay = openMinutes;
      minuteOfDay + SLOT_LENGTH_MINUTES <= closeMinutes;
      minuteOfDay += SLOT_LENGTH_MINUTES
    ) {
      const hh = pad(Math.floor(minuteOfDay / 60));
      const mm = pad(minuteOfDay % 60);
      const localTimeString = `${dateStr}T${hh}:${mm}:00`;
      const startTime = fromZonedTime(localTimeString, TIME_ZONE);
      const endTime = addMinutes(startTime, SLOT_LENGTH_MINUTES);
      slots.push({ startTime, endTime, label: `${hh}:${mm}` });
    }
  }

  return slots;
}

/** Finner en spesifikk rutenett-slot (f.eks. fra et klokkeslett brukeren har valgt i UI-et). */
export function findSlot(dateStr: string, timeLabel: string, intervals: OpeningInterval[]): SlotDefinition | null {
  const slots = generateSlotsForDate(dateStr, intervals);
  return slots.find((slot) => slot.label === timeLabel) ?? null;
}

/**
 * Beregner start/slutt for én faktisk øktforekomst: gitt en startdato,
 * klokkeslett og varighet (i antall SLOT_LENGTH_MINUTES-tidsluker), er
 * sluttidspunktet start + durationSlots * SLOT_LENGTH_MINUTES. Brukes for
 * både enkeltøkter og hver forekomst i en gjentakende rekke.
 *
 * Kaster ikke selv om sluttidspunktet går forbi stengetid – det sjekkes
 * separat (isWithinOpeningHours) slik at API-ruten kan gi en tydelig
 * feilmelding i stedet for en kryptisk låsing.
 */
export function occurrenceRange(
  dateStr: string,
  timeLabel: string,
  durationSlots: number
): { startTime: Date; endTime: Date } | null {
  const [hh, mm] = timeLabel.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;

  const localTimeString = `${dateStr}T${pad(hh)}:${pad(mm)}:00`;
  const startTime = fromZonedTime(localTimeString, TIME_ZONE);
  const endTime = addMinutes(startTime, durationSlots * SLOT_LENGTH_MINUTES);
  return { startTime, endTime };
}

/**
 * Om et tidsrom (i lokal klubb-tidssone) holder seg innenfor åpningstidene
 * på sin egen dag. Økter krysser aldri midnatt i denne appen (hver økt er
 * høyst 1 time lang – se BOOKABLE_DURATIONS_MINUTES i lib/config.ts), så vi
 * kan trygt kreve at start og slutt er på samme kalenderdag.
 *
 * `intervals` er den EFFEKTIVE åpningstiden for akkurat denne dagen (fra
 * lib/settings/openingHours.ts) – IKKE globale konstanter lenger, siden
 * åpningstider nå kan variere per ukedag og per "ferie/annerledesdag", OG
 * kan bestå av FLERE tidsrom samme dag (f.eks. lunsjstengt). Tidsrommet er
 * gyldig så lenge det holder seg innenfor ETT ENKELT av disse tidsrommene –
 * det er ikke nok at start og slutt til sammen "dekkes" av to ulike tidsrom
 * med et hull mellom (en økt kan jo ikke krysse en lunsjpause).
 *
 * `closed: true` betyr at dagen er helt stengt uansett klokkeslett.
 */
export function isWithinOpeningHours(
  startTime: Date,
  endTime: Date,
  hours: { closed: boolean; intervals: { open: string; close: string }[] }
): boolean {
  if (hours.closed || hours.intervals.length === 0) return false;

  const startDay = format(startTime, "yyyy-MM-dd", { timeZone: TIME_ZONE });
  const endDay = format(endTime, "yyyy-MM-dd", { timeZone: TIME_ZONE });
  if (startDay !== endDay) return false;

  const startLocal = format(startTime, "HH:mm", { timeZone: TIME_ZONE });
  const endLocal = format(endTime, "HH:mm", { timeZone: TIME_ZONE });
  return hours.intervals.some((interval) => startLocal >= interval.open && endLocal <= interval.close);
}

/**
 * Beregner start/slutt fra to eksplisitte klokkeslett samme dag (f.eks.
 * "10:00" til "14:00"). Brukt av adminpanelet til å blokkere et fritt valgt
 * tidsrom (vedlikehold, turnering) – i motsetning til occurrenceRange, som
 * er låst til rutenettet med hele timer og maks varighet for vanlige
 * bookinger.
 */
export function rangeFromLabels(
  dateStr: string,
  startLabel: string,
  endLabel: string
): { startTime: Date; endTime: Date } | null {
  if (!/^\d{2}:\d{2}$/.test(startLabel) || !/^\d{2}:\d{2}$/.test(endLabel)) return null;

  const startTime = fromZonedTime(`${dateStr}T${startLabel}:00`, TIME_ZONE);
  const endTime = fromZonedTime(`${dateStr}T${endLabel}:00`, TIME_ZONE);
  if (endTime.getTime() <= startTime.getTime()) return null;

  return { startTime, endTime };
}

/**
 * Genererer datoene (som "YYYY-MM-DD") for en gjentakende ukentlig rekke,
 * med samme ukedag/klokkeslett som `firstDate`, `weeks` forekomster totalt
 * (inkludert den første).
 */
export function generateWeeklyDates(firstDate: string, weeks: number): string[] {
  const clampedWeeks = Math.max(1, Math.min(weeks, MAX_RECURRING_WEEKS));
  const dates: string[] = [];
  const [y, m, d] = firstDate.split("-").map(Number);
  const baseMs = Date.UTC(y, m - 1, d);
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  // Ren UTC-millisekund-aritmetikk med vilje (ikke date-fns' addWeeks, som
  // bruker VERTENS lokale tidssone til å legge til dager) – slik blir
  // datoene korrekte uansett hvilken tidssone serveren/maskinen kjører i.
  for (let i = 0; i < clampedWeeks; i++) {
    const next = new Date(baseMs + i * WEEK_MS);
    dates.push(`${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`);
  }

  return dates;
}
