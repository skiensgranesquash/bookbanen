import { addDays, addMinutes } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { MAX_DAYS_AHEAD, MAX_RECURRING_WEEKS, SLOT_LENGTH_MINUTES, TIME_ZONE } from "./config";

/**
 * Henter dato- og klokkeslett-komponenter for et tidspunkt i en gitt
 * IANA-tidssone, med Intl.DateTimeFormat (innebygd i JavaScript) i stedet
 * for date-fns-tz sin egen `format(..., { timeZone })`.
 *
 * Grunnen: `format(..., { timeZone: TIME_ZONE })` fra date-fns-tz brukte vi
 * tidligere her, men i kjøretidsmiljøet dette faktisk kjører i (Netlify
 * Functions) stille-ignorerer den timeZone-valget og formaterer i UTC i
 * stedet for Europe/Oslo. Det ble bekreftet direkte mot produksjon: en
 * resepsjon forsøkte å booke en gjentakende time kl. 05:00 norsk tid, som
 * ble avvist som "stengt" – fordi koden i praksis sjekket den som om den
 * startet 04:00 (UTC). Alt mellom midnatt og normal-tidssonens offset fra
 * UTC (05:00-05:59 vinterstid) traff dermed feil side av åpningstiden.
 * Samme feil kunne i prinsippet også ha gjort at en booking helt i
 * stengetidsgrensa feilaktig ble godtatt, siden den samme 1-times-forskyvin-
 * gen gjelder begge veier.
 *
 * Intl.DateTimeFormat sin tidssone-håndtering er en del av selve
 * JavaScript-motoren (ikke avhengig av en ekstra tidssone-database som kan
 * mangle i et redusert kjøretidsmiljø), så dette er en tryggere, uavhengig
 * vei til nøyaktig samme tall – verifisert direkte mot live-API-et etter
 * denne endringen (05:00, 05:30 og 06:00 norsk tid ga nå alle riktig svar,
 * der kun 05:00/05:30 tidligere feilaktig ble vist som stengt).
 */
function zonedParts(
  date: Date,
  timeZone: string
): { y: string; m: string; d: string; hh: string; mm: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute") };
}

/** "YYYY-MM-DD" for et tidspunkt i en gitt tidssone – se zonedParts over. */
function zonedDateString(date: Date, timeZone: string): string {
  const { y, m, d } = zonedParts(date, timeZone);
  return `${y}-${m}-${d}`;
}

/** "HH:mm" for et tidspunkt i en gitt tidssone – se zonedParts over. */
function zonedTimeString(date: Date, timeZone: string): string {
  const { hh, mm } = zonedParts(date, timeZone);
  return `${hh}:${mm}`;
}

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
  return zonedDateString(new Date(), TIME_ZONE);
}

/** Siste dato man har lov til å booke en enkelttime, som "YYYY-MM-DD". */
export function maxBookableDate(): string {
  return zonedDateString(addDays(new Date(), MAX_DAYS_AHEAD), TIME_ZONE);
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

  const startDay = zonedDateString(startTime, TIME_ZONE);
  const endDay = zonedDateString(endTime, TIME_ZONE);
  if (startDay !== endDay) return false;

  const startLocal = zonedTimeString(startTime, TIME_ZONE);
  const endLocal = zonedTimeString(endTime, TIME_ZONE);
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

/**
 * Hvor mange uker en gjentakende rekke MAKS kan ha fra og med `firstDate`
 * (inkludert den første forekomsten), uten at noen forekomst havner etter
 * klubbens egen grense for gjentakende bookinger (`cutoffDate` – se
 * lib/settings/recurringLimit.ts; `null` betyr ingen egen grense, og da er
 * det bare MAX_RECURRING_WEEKS som gjelder).
 *
 * Brukes til å begrense selve "antall uker"-feltet i UI-et (se
 * BookingCalendar.tsx) FØR brukeren betaler, i stedet for å oppdage for sent
 * (etter betaling) at rekken ble kuttet fordi noen av ukene lå forbi grensen
 * – se POST /api/squash/bookings, som uansett også håndhever dette på nytt,
 * atomisk, ved selve opprettelsen.
 *
 * Samme rene UTC-millisekund-aritmetikk som generateWeeklyDates over, av
 * samme grunn (tidssone-uavhengig datoregning).
 */
export function maxRecurringWeeksUntil(
  firstDate: string,
  cutoffDate: string | null,
  maxWeeksSetting: number | null = null
): number {
  const configuredCap =
    maxWeeksSetting != null ? Math.max(0, Math.min(MAX_RECURRING_WEEKS, maxWeeksSetting)) : MAX_RECURRING_WEEKS;

  if (!cutoffDate) return configuredCap;

  const [fy, fm, fd] = firstDate.split("-").map(Number);
  const [cy, cm, cd] = cutoffDate.split("-").map(Number);
  const firstMs = Date.UTC(fy, fm - 1, fd);
  const cutoffMs = Date.UTC(cy, cm - 1, cd);
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  const weeksUntilCutoff = Math.floor((cutoffMs - firstMs) / WEEK_MS) + 1;
  return Math.max(0, Math.min(configuredCap, weeksUntilCutoff));
}
