import { NextRequest, NextResponse } from "next/server";
import { addDays } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { getRepository } from "@/lib/db";
import { TIME_ZONE } from "@/lib/config";
import { isValidBookingDateString, isWithinOpeningHours, rangeFromLabels } from "@/lib/slots";
import { effectiveHoursForDate, getHoursContext } from "@/lib/settings/openingHours";
import type { TimeRange } from "@/lib/db/types";

export const dynamic = "force-dynamic";

/** Maks antall kalenderdager én blokkering kan strekke seg over – en sikkerhetsmargin mot f.eks. et feiltastet årstall som ville prøve å blokkere tusenvis av dager. */
const MAX_BLOCK_DAYS = 180;

interface BlockBody {
  fromDate?: string;
  toDate?: string;
  wholeDay?: boolean;
  startTime?: string;
  endTime?: string;
  note?: string;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Alle datoene ("YYYY-MM-DD") fra fromDate til og med toDate, ren UTC-ms-aritmetikk (samme mønster som generateWeeklyDates i lib/slots.ts) – uavhengig av serverens egen tidssone. */
function datesBetween(fromDate: string, toDate: string): string[] {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  const DAY_MS = 24 * 60 * 60 * 1000;

  const dates: string[] = [];
  for (let ms = fromMs; ms <= toMs; ms += DAY_MS) {
    const d = new Date(ms);
    dates.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
  }
  return dates;
}

/**
 * POST /api/admin/block
 * Body: { fromDate: "YYYY-MM-DD", toDate: "YYYY-MM-DD", wholeDay: boolean,
 *         startTime?: "HH:mm", endTime?: "HH:mm", note: string }
 *
 * Stenger banen (ingen betaling) i ÉN eller FLERE dager på rad – `fromDate`
 * og `toDate` kan være samme dato (brukt av "blokker denne dagen"-boksen i
 * adminpanelet) eller en hel rekke (den smale stripen under kalenderen).
 * Hver dag i rekken blir sin EGEN slot under samme blokkerings-gruppe (se
 * BookingRepository.createBlock), slik at hele rekken opprettes atomisk –
 * enten går ALLE dagene gjennom, eller ingen (f.eks. hvis én av dem allerede
 * har en ekte booking).
 *
 * `wholeDay: true` blokkerer den lokale kalenderdøgnet fra midnatt til
 * midnatt, UANSETT konfigurerte åpningstider (banen er jo likevel ikke åpen
 * før/etter åpningstid, så dette er bare en enkel, forutsigbar "hele dagen"-
 * garanti). `wholeDay: false` bruker i stedet et eksplisitt klokkeslett
 * (samme hver dag i rekken), validert mot DENNE dagens EFFEKTIVE åpningstid.
 */
export async function POST(request: NextRequest) {
  let body: BlockBody;
  try {
    body = (await request.json()) as BlockBody;
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  const { fromDate, wholeDay } = body;
  const toDate = body.toDate || body.fromDate;
  const note = body.note?.trim() ?? "";

  if (!fromDate || !isValidBookingDateString(fromDate)) {
    return NextResponse.json({ error: "Ugyldig fra-dato." }, { status: 400 });
  }
  if (!toDate || !isValidBookingDateString(toDate)) {
    return NextResponse.json({ error: "Ugyldig til-dato." }, { status: 400 });
  }
  if (toDate < fromDate) {
    return NextResponse.json({ error: "Til-dato kan ikke være før fra-dato." }, { status: 400 });
  }
  if (!note) {
    return NextResponse.json({ error: "Skriv en kort forklaring (vises i bookingoversikten)." }, { status: 400 });
  }

  const dates = datesBetween(fromDate, toDate);
  if (dates.length > MAX_BLOCK_DAYS) {
    return NextResponse.json(
      { error: `Tidsrommet er for langt – maks ${MAX_BLOCK_DAYS} dager om gangen.` },
      { status: 400 }
    );
  }

  const ranges: TimeRange[] = [];

  if (wholeDay) {
    for (const dateStr of dates) {
      const startTime = fromZonedTime(`${dateStr}T00:00:00`, TIME_ZONE);
      const endTime = addDays(startTime, 1);
      ranges.push({ startTime: startTime.toISOString(), endTime: endTime.toISOString() });
    }
  } else {
    const hoursContext = await getHoursContext();
    for (const dateStr of dates) {
      const range = rangeFromLabels(dateStr, body.startTime ?? "", body.endTime ?? "");
      if (!range) {
        return NextResponse.json({ error: "Ugyldig tidsrom (sluttid må være etter starttid)." }, { status: 400 });
      }
      if (!isWithinOpeningHours(range.startTime, range.endTime, effectiveHoursForDate(dateStr, hoursContext))) {
        return NextResponse.json(
          { error: `Tidsrommet må være innenfor åpningstidene (${dateStr} er stengt eller passer ikke).` },
          { status: 400 }
        );
      }
      ranges.push({ startTime: range.startTime.toISOString(), endTime: range.endTime.toISOString() });
    }
  }

  const repo = await getRepository();
  const result = await repo.createBlock(ranges, note);
  if (!result.ok) {
    return NextResponse.json(
      { error: "Tidsrommet overlapper med en eksisterende booking.", conflicts: result.conflicts },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, id: result.group.id });
}
