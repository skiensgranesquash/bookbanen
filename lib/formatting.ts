import { format } from "date-fns-tz";
import { nb } from "date-fns/locale";
import { TIME_ZONE } from "./config";

/** Formaterer et ISO-tidspunkt i klubbens tidssone, med norske måneds-/ukedagsnavn. */
export function formatOslo(iso: string | Date, pattern: string): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return format(date, pattern, { timeZone: TIME_ZONE, locale: nb });
}

export function formatPriceOre(ore: number): string {
  return `${(ore / 100).toLocaleString("nb-NO")} kr`;
}

/** Formaterer en varighet i minutter kompakt på norsk, f.eks. 30 → "30 min", 60 → "1 time", 90 → "1,5 timer". */
export function formatDurationMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  const hoursLabel = Number.isInteger(hours) ? `${hours}` : hours.toFixed(1).replace(".", ",");
  return `${hoursLabel} ${hours === 1 ? "time" : "timer"}`;
}
