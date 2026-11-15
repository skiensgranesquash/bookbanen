import "server-only";
import { getRepository } from "@/lib/db";
import { isValidDateString } from "./openingHours";
import { todayInClubTimeZone } from "@/lib/slots";

/**
 * Turneringsfunksjon: admin setter ÉN delt kode som spillere kan skrive inn
 * når de booker en enkelttime på den offentlige bookingsiden (se
 * app/BookingCalendar.tsx) – da hopper de over betaling, og skriver i stedet
 * inn hvem de møter ("motstander", se opponentName i lib/db/types.ts) i
 * stedet for telefonnummer. Koden gjelder KUN enkelttimer, ikke gjentakende
 * bookinger (se håndhevingen i app/api/squash/bookings/route.ts).
 *
 * Lagret som tre separate nøkler i den samme generiske nøkkel/verdi-
 * innstillingstabellen som resten av innstillingene (se lib/settings/pricing.ts
 * for samme mønster med flere uavhengige nøkler) – ETT sett med innstillinger
 * for HELE turneringen (ikke én kode per kamp), per admins eget valg.
 */
const CODE_KEY = "tournamentCode";
const ACTIVE_KEY = "tournamentActive";
const EXPIRES_KEY = "tournamentExpiresAt";

export interface TournamentSettings {
  /** Den delte koden spillere skriver inn – tom streng betyr at ingen kode er satt ennå. */
  code: string;
  /** Av/på-bryteren – koden godtas KUN når denne er true, uavhengig av om expiresAt også tillater det. */
  active: boolean;
  /** Siste dato ("YYYY-MM-DD") koden kan brukes, eller null for ingen utløpsdato. */
  expiresAt: string | null;
}

export async function getTournamentSettings(): Promise<TournamentSettings> {
  const repo = await getRepository();
  const [code, activeRaw, expiresAt] = await Promise.all([
    repo.getSetting(CODE_KEY),
    repo.getSetting(ACTIVE_KEY),
    repo.getSetting(EXPIRES_KEY),
  ]);

  return {
    code: code ?? "",
    active: activeRaw === "true",
    expiresAt: expiresAt && isValidDateString(expiresAt) ? expiresAt : null,
  };
}

/** Kaster med en norsk feilmelding ved en ugyldig utløpsdato, eller hvis koden skrus på uten at noen kode er satt. */
export async function saveTournamentSettings(input: TournamentSettings): Promise<TournamentSettings> {
  const code = input.code.trim();
  if (input.active && !code) {
    throw new Error("Skriv inn en kode før turneringen kan skrus på.");
  }
  if (input.expiresAt !== null && !isValidDateString(input.expiresAt)) {
    throw new Error("Ugyldig utløpsdato (forventet format ÅÅÅÅ-MM-DD).");
  }

  const repo = await getRepository();
  await Promise.all([
    repo.setSetting(CODE_KEY, code),
    repo.setSetting(ACTIVE_KEY, input.active ? "true" : "false"),
    repo.setSetting(EXPIRES_KEY, input.expiresAt ?? ""),
  ]);

  return { code, active: input.active, expiresAt: input.expiresAt };
}

/**
 * Den faktiske sjekken brukt BÅDE av den offentlige "er denne koden gyldig
 * akkurat nå"-sjekken (se app/api/squash/tournament-code/route.ts, kalt mens
 * kunden skriver) OG av selve bookingen (se app/api/squash/bookings/route.ts,
 * sjekket på nytt server-side – aldri stol på klientens egen "gyldig kode"-
 * sjekk alene). Sammenligner uten hensyn til store/små bokstaver eller
 * ekstra mellomrom, siden en spiller lett kan skrive koden litt annerledes
 * enn admin gjorde.
 */
export async function isTournamentCodeValid(inputCode: string): Promise<boolean> {
  const trimmed = inputCode.trim();
  if (!trimmed) return false;

  const settings = await getTournamentSettings();
  if (!settings.active || !settings.code) return false;
  if (trimmed.toLowerCase() !== settings.code.trim().toLowerCase()) return false;
  if (settings.expiresAt && todayInClubTimeZone() > settings.expiresAt) return false;

  return true;
}
