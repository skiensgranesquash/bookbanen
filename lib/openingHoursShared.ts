/**
 * Rene, klient-trygge typer og funksjoner for effektive åpningstider –
 * flyttet ut av lib/settings/openingHours.ts (som er merket "server-only"
 * siden resten av den filen snakker direkte med databasen) slik at
 * ADMIN-KALENDEREN (app/admin/BookingsInsights.tsx, en "use client"-
 * komponent) kan regne ut om en gitt dag er stengt uten noe eget
 * nettverkskall per dato – komponenten henter én HoursContext (se
 * app/api/admin/bookings/hours/route.ts) og kaller effectiveHoursForDate
 * selv, akkurat som /api/squash/recurring-preview og
 * /api/admin/bookings/manual allerede gjør på serveren.
 *
 * lib/settings/openingHours.ts re-eksporterer ALT herfra (export *), slik
 * at ingen av de eksisterende (server-side) importene andre steder i
 * kodebasen trenger å endres.
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

/** Ukedagen til en kalenderdato er tidssone-uavhengig (datoen er allerede en lokal "YYYY-MM-DD" i klubbens tidssone) – ren UTC-aritmetikk holder. */
export function weekdayKeyFor(dateStr: string): WeekdayKey {
  const [y, m, d] = dateStr.split("-").map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=søn..6=lør
  const map: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[jsDay];
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
