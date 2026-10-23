import "server-only";
import { getRepository } from "@/lib/db";
import { CLOSING_HOUR, OPENING_HOUR } from "@/lib/config";

/**
 * Åpningstider satt via adminpanelet, lagret i den samme generiske
 * nøkkel/verdi-innstillingstabellen som Vipps-nøklene (se
 * lib/settings/vippsSettings.ts for samme mønster) – ingen nytt
 * databaseskjema trengs, verken for den lokale JSON-filen eller for
 * Supabase (begge har allerede getSetting/setSetting via app_settings).
 *
 * To lag med åpningstider, der det mer spesifikke alltid vinner:
 *  1) "weeklyOpeningHours" – standard åpningstid per ukedag (man–søn), gjelder
 *     ALLE dager med mindre de er satt opp med noe annet.
 *  2) "calendarExceptions" – "ferier og annerledesdager": enkeltdatoer som
 *     overstyrer ukedagens standard (helt stengt, eller egne klokkeslett),
 *     med en valgfri forklaring (f.eks. "Jul", "Dugnad").
 *
 * Hver dag (både en vanlig ukedag og et unntak) kan ha ETT ELLER FLERE
 * tidsrom i stedet for bare ett sammenhengende åpent/stengt-vindu – f.eks.
 * åpent 05:00–11:00 og 12:00–17:00 samme dag (lunsjstengt midt på).
 * `generateSlotsForDate` (lib/slots.ts) genererer rutenett-tidsluker separat
 * for hvert tidsrom, slik at det automatisk blir et "hull" i rutenettet
 * mellom dem – ingen booking kan starte slik at den ville krysset pausen.
 */

export type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const WEEKDAY_KEYS: WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  mon: "Mandag",
  tue: "Tirsdag",
  wed: "Onsdag",
  thu: "Torsdag",
  fri: "Fredag",
  sat: "Lørdag",
  sun: "Søndag",
};

/** Ett sammenhengende åpent tidsrom innenfor én kalenderdag, "HH:mm"–"HH:mm". */
export interface TimeInterval {
  open: string;
  close: string;
}

export interface DayHours {
  closed: boolean;
  /** Ett eller flere ikke-overlappende tidsrom, sortert stigende. Tom array når closed=true. */
  intervals: TimeInterval[];
}

export type WeeklyHours = Record<WeekdayKey, DayHours>;

export interface CalendarException {
  /** "YYYY-MM-DD". */
  date: string;
  closed: boolean;
  /** Tom array når closed=true. */
  intervals: TimeInterval[];
  /** Forklaring vist i adminpanelet (og i "stengt"-meldingen på bookingsiden). */
  note: string;
}

export interface EffectiveHours {
  closed: boolean;
  /** Tom array når closed=true (eller når dagen – i teorien – ikke har noen gyldige tidsrom). */
  intervals: TimeInterval[];
  note: string | null;
  /** Om dette kommer fra en "ferie/annerledesdag"-unntak (ikke bare ukedagens standard). */
  isException: boolean;
}

export interface HoursContext {
  weekly: WeeklyHours;
  exceptions: CalendarException[];
}

const WEEKLY_KEY = "weeklyOpeningHours";
const EXCEPTIONS_KEY = "calendarExceptions";

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export function isValidTimeString(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const asDate = new Date(Date.UTC(y, m - 1, d));
  return asDate.getUTCFullYear() === y && asDate.getUTCMonth() === m - 1 && asDate.getUTCDate() === d;
}

function defaultDayHours(): DayHours {
  return { closed: false, intervals: [{ open: `${pad(OPENING_HOUR)}:00`, close: `${pad(CLOSING_HOUR)}:00` }] };
}

function defaultWeeklyHours(): WeeklyHours {
  const hours = {} as WeeklyHours;
  for (const key of WEEKDAY_KEYS) hours[key] = defaultDayHours();
  return hours;
}

/** Rydder opp og sorterer en liste tidsrom lest fra lagret JSON – dropper ugyldige/tomme elementer uten å kaste. */
function sanitizeIntervals(input: unknown): TimeInterval[] {
  if (!Array.isArray(input)) return [];
  const result: TimeInterval[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Partial<TimeInterval>;
    if (!isValidTimeString(candidate.open) || !isValidTimeString(candidate.close)) continue;
    if (candidate.close <= candidate.open) continue;
    result.push({ open: candidate.open, close: candidate.close });
  }
  result.sort((a, b) => a.open.localeCompare(b.open));
  return result;
}

function sanitizeDayHours(input: unknown): DayHours {
  if (!input || typeof input !== "object") return defaultDayHours();
  const candidate = input as { closed?: boolean; intervals?: unknown; open?: unknown; close?: unknown };
  if (candidate.closed) return { closed: true, intervals: [] };

  // Migrering: tidligere versjoner lagret ett enkelt open/close-par per dag i
  // stedet for et intervals-array – les det gamle formatet som ETT tidsrom
  // hvis det nye feltet mangler, slik at eksisterende lagrede data (lokal
  // JSON-fil eller Supabase) fortsatt fungerer uten noen manuell migrering.
  if (!candidate.intervals && isValidTimeString(candidate.open) && isValidTimeString(candidate.close)) {
    return { closed: false, intervals: [{ open: candidate.open, close: candidate.close }] };
  }

  const intervals = sanitizeIntervals(candidate.intervals);
  return intervals.length > 0 ? { closed: false, intervals } : defaultDayHours();
}

export async function getWeeklyHours(): Promise<WeeklyHours> {
  const repo = await getRepository();
  const raw = await repo.getSetting(WEEKLY_KEY);
  const fallback = defaultWeeklyHours();
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as Partial<Record<WeekdayKey, unknown>>;
    const result = {} as WeeklyHours;
    for (const key of WEEKDAY_KEYS) {
      result[key] = key in parsed ? sanitizeDayHours(parsed[key]) : fallback[key];
    }
    return result;
  } catch {
    return fallback;
  }
}

/** Validerer en liste tidsrom for én dag/ett sett datoer: minst ett, gyldige klokkeslett, ingen overlapp. Kaster med en norsk feilmelding. */
function validateIntervals(intervals: unknown, context: string): TimeInterval[] {
  if (!Array.isArray(intervals) || intervals.length === 0) {
    throw new Error(`Legg til minst ett tidsrom for ${context}, eller merk dagen/dagene som stengt.`);
  }

  const result: TimeInterval[] = [];
  for (const raw of intervals) {
    const candidate = (raw ?? {}) as Partial<TimeInterval>;
    if (!isValidTimeString(candidate.open) || !isValidTimeString(candidate.close)) {
      throw new Error(`Ugyldig klokkeslett for ${context}.`);
    }
    if (candidate.close <= candidate.open) {
      throw new Error(`Stengetid må være etter åpningstid for ${context}.`);
    }
    result.push({ open: candidate.open, close: candidate.close });
  }

  result.sort((a, b) => a.open.localeCompare(b.open));
  for (let i = 1; i < result.length; i++) {
    if (result[i].open < result[i - 1].close) {
      throw new Error(`Tidsrommene for ${context} overlapper – juster klokkeslettene.`);
    }
  }
  return result;
}

/** Validerer og lagrer ukentlige standard-åpningstider. Kaster med en norsk feilmelding ved ugyldige verdier. */
export async function saveWeeklyHours(
  input: Partial<Record<WeekdayKey, { closed?: boolean; intervals?: Partial<TimeInterval>[] }>>
): Promise<WeeklyHours> {
  const next = {} as WeeklyHours;
  for (const key of WEEKDAY_KEYS) {
    const day = input[key];
    if (!day) throw new Error(`Mangler åpningstider for ${WEEKDAY_LABELS[key].toLowerCase()}.`);
    if (day.closed) {
      next[key] = { closed: true, intervals: [] };
      continue;
    }
    next[key] = { closed: false, intervals: validateIntervals(day.intervals, WEEKDAY_LABELS[key].toLowerCase()) };
  }

  const repo = await getRepository();
  await repo.setSetting(WEEKLY_KEY, JSON.stringify(next));
  return next;
}

function sanitizeException(raw: unknown): CalendarException | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { date?: unknown; closed?: boolean; note?: unknown; intervals?: unknown; open?: unknown; close?: unknown };
  if (!isValidDateString(candidate.date)) return null;
  const note = typeof candidate.note === "string" ? candidate.note : "";

  if (candidate.closed) {
    return { date: candidate.date, closed: true, intervals: [], note };
  }

  // Samme migrering som for ukentlige åpningstider – se sanitizeDayHours over.
  if (!candidate.intervals && isValidTimeString(candidate.open) && isValidTimeString(candidate.close)) {
    return { date: candidate.date, closed: false, intervals: [{ open: candidate.open, close: candidate.close }], note };
  }

  const intervals = sanitizeIntervals(candidate.intervals);
  if (intervals.length === 0) return null;
  return { date: candidate.date, closed: false, intervals, note };
}

export async function getExceptions(): Promise<CalendarException[]> {
  const repo = await getRepository();
  const raw = await repo.getSetting(EXCEPTIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const result: CalendarException[] = [];
    for (const item of parsed) {
      const sanitized = sanitizeException(item);
      if (sanitized) result.push(sanitized);
    }
    return result.sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

async function saveExceptions(list: CalendarException[]): Promise<void> {
  const repo = await getRepository();
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  await repo.setSetting(EXCEPTIONS_KEY, JSON.stringify(sorted));
}

export interface BulkExceptionInput {
  closed: boolean;
  intervals?: Partial<TimeInterval>[];
  note?: string;
}

/**
 * Setter (eller overskriver) et unntak for HVER av de gitte datoene – dette
 * er "masseendre"-operasjonen adminpanelet bruker når man har markert flere
 * dager i kalenderen. Alle andre eksisterende unntak beholdes uendret.
 */
export async function upsertExceptionsForDates(
  dates: string[],
  input: BulkExceptionInput
): Promise<CalendarException[]> {
  const validDates = dates.filter(isValidDateString);
  if (validDates.length === 0) throw new Error("Ingen gyldige datoer valgt.");

  const intervals = input.closed ? [] : validateIntervals(input.intervals, "de valgte dagene");

  const existing = await getExceptions();
  const dateSet = new Set(validDates);
  const kept = existing.filter((e) => !dateSet.has(e.date));

  const entries: CalendarException[] = validDates.map((date) => ({
    date,
    closed: input.closed,
    intervals,
    note: (input.note ?? "").trim(),
  }));

  const next = [...kept, ...entries];
  await saveExceptions(next);
  return next.sort((a, b) => a.date.localeCompare(b.date));
}

/** Fjerner unntak for de gitte datoene igjen (tilbake til ukedagens standard). */
export async function removeExceptionsForDates(dates: string[]): Promise<CalendarException[]> {
  const existing = await getExceptions();
  const dateSet = new Set(dates);
  const next = existing.filter((e) => !dateSet.has(e.date));
  await saveExceptions(next);
  return next;
}

function weekdayKeyFor(dateStr: string): WeekdayKey {
  // Ukedagen til en kalenderdato er tidssone-uavhengig (datoen er allerede en
  // lokal "YYYY-MM-DD" i klubbens tidssone) – ren UTC-aritmetikk holder.
  const [y, m, d] = dateStr.split("-").map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=søn..6=lør
  const map: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[jsDay];
}

/** Henter begge innstillings-lagene i ÉT oppslag – bruk denne (ikke getEffectiveHoursForDate i en løkke) når flere datoer skal sjekkes i samme forespørsel, f.eks. en gjentakende booking over mange uker. */
export async function getHoursContext(): Promise<HoursContext> {
  const [weekly, exceptions] = await Promise.all([getWeeklyHours(), getExceptions()]);
  return { weekly, exceptions };
}

/** Ren (synkron) utregning av effektive åpningstider for én dato, gitt en allerede innhentet HoursContext. */
export function effectiveHoursForDate(dateStr: string, context: HoursContext): EffectiveHours {
  const exception = context.exceptions.find((e) => e.date === dateStr);
  if (exception) {
    return {
      closed: exception.closed,
      intervals: exception.intervals,
      note: exception.note || null,
      isException: true,
    };
  }

  const day = context.weekly[weekdayKeyFor(dateStr)];
  return {
    closed: day.closed,
    intervals: day.intervals,
    note: null,
    isException: false,
  };
}

/** Bekvemmelighetsfunksjon for når man kun trenger ÉN dato (f.eks. /api/squash/availability). */
export async function getEffectiveHoursForDate(dateStr: string): Promise<EffectiveHours> {
  const context = await getHoursContext();
  return effectiveHoursForDate(dateStr, context);
}
