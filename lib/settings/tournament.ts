import "server-only";
import { getRepository } from "@/lib/db";
import { todayInClubTimeZone } from "@/lib/slots";
import type { Tournament } from "@/lib/db/types";

/**
 * Turneringsfunksjon: admin kan nå lage FLERE turneringer (se
 * app/admin/koder/turneringer/TournamentsManager.tsx + Tournament i
 * lib/db/types.ts), hver med sin egen kode/av-på-bryter/utløpsdato – i
 * stedet for ETT delt sett med innstillinger (den gamle modellen denne fila
 * tidligere implementerte selv, med de tre nøklene tournamentCode/
 * tournamentActive/tournamentExpiresAt i app_settings). Denne fila er derfor
 * nå bare selve KODE-OPPSLAGET på tvers av alle turneringer, brukt BÅDE av
 * den offentlige "er denne koden gyldig akkurat nå"-sjekken (se
 * app/api/squash/tournament-code/route.ts, kalt mens kunden skriver) OG av
 * selve bookingen (se app/api/squash/bookings/route.ts, sjekket på nytt
 * server-side – aldri stol på klientens egen "gyldig kode"-sjekk alene).
 */

/**
 * Finner den (ene) aktive, ikke-utløpte turneringen hvis kode matcher –
 * uten hensyn til store/små bokstaver eller ekstra mellomrom, siden en
 * spiller lett kan skrive koden litt annerledes enn admin gjorde. Admin-
 * API-et (app/api/admin/tournaments/route.ts) hindrer to turneringer i å
 * dele samme kode, så matchet bør alltid være unikt – finner vi likevel
 * flere (f.eks. gammel data), brukes ganske enkelt den første.
 */
export async function findValidTournamentByCode(inputCode: string): Promise<Tournament | null> {
  const trimmed = inputCode.trim();
  if (!trimmed) return null;

  const repo = await getRepository();
  const tournaments = await repo.listTournaments();
  const today = todayInClubTimeZone();

  return (
    tournaments.find(
      (t) => t.active && (!t.expiresAt || today <= t.expiresAt) && t.code.trim().toLowerCase() === trimmed.toLowerCase()
    ) ?? null
  );
}

export async function isTournamentCodeValid(inputCode: string): Promise<boolean> {
  return (await findValidTournamentByCode(inputCode)) !== null;
}
