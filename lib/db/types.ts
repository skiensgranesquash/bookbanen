/**
 * Delt datamodell + repository-grensesnitt. To implementasjoner finnes:
 * - lib/db/local.ts    (JSON-fil, brukt lokalt – se DB_DRIVER i lib/config.ts)
 * - lib/db/supabase.ts (Postgres, brukt i produksjon)
 *
 * Modellen er delt i to nivåer med vilje:
 * - En BookingGroup er "bestillingen" – én betaling, én kunde, én status.
 * - Hver BookingGroup har én eller flere BookingSlots – de faktiske
 *   tidsrommene på banen den opptar. En enkeltbooking har én slot. En
 *   booking på 2 sammenhengende timer har fortsatt bare oftest én slot (med
 *   et 2-timers tidsrom), MEN en gjentakende ukentlig booking har én slot
 *   PER uke – alle knyttet til samme gruppe/betaling.
 *
 * Dette gjør det enkelt å svare på "er denne tiden ledig?" (sjekk om noe
 * overlapper i booking_slots for aktive grupper), og "hva hører til denne
 * betalingen?" (alle slots med samme group_id) uten å blande de to
 * spørsmålene sammen.
 */

export type BookingStatus = "pending" | "confirmed" | "cancelled" | "expired";

/** "single" = én økt (evt. flere sammenhengende timer). "recurring" = samme ukedag/tid i flere uker. "block" = admin har stengt tiden (vedlikehold e.l.), ingen betaling. */
export type BookingKind = "single" | "recurring" | "block";

/**
 * Om bookingen ble opprettet av kunden selv (den offentlige bookingsiden, med
 * ekte eller simulert Vipps-betaling) eller av admin direkte (f.eks. "Book
 * uten betaling" i adminpanelet, eller en blokkering) – brukes til å vise et
 * "Manuelt"-merke i "Siste bookinger" (se app/admin/AdminDashboard.tsx), slik
 * at det alltid er tydelig HVORDAN en bekreftet booking kom i stand.
 */
export type BookingSource = "customer" | "admin";

export interface BookingGroup {
  id: string;
  status: BookingStatus;
  kind: BookingKind;
  source: BookingSource;
  customerName: string;
  customerPhone: string;
  totalAmountOre: number;
  /** Betalingsreferanse hos betalingsleverandøren (samme som id i praksis, men holdt separat for tydelighet). */
  paymentReference: string;
  /** Når et pending-hold skal frigis automatisk hvis betalingen ikke fullføres. Null når status ikke er "pending". */
  holdExpiresAt: string | null;
  /** Kun satt for kind "block" – admin sin notat om hvorfor tiden er stengt. */
  note: string | null;
  /** Kun satt for en turneringsbooking (se lib/settings/tournament.ts) – hvem kunden møter. Null for alle andre bookinger. */
  opponentName: string | null;
  /** Hvilken turnering (se Tournament over) en turneringsbooking hører til – null for alle andre bookinger, og også null for en turneringsbooking hvis selve turneringen senere slettes (se "on delete set null" i migrasjonen). */
  tournamentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingSlot {
  id: string;
  groupId: string;
  courtId: string;
  /** ISO-8601 UTC-tidspunkt. */
  startTime: string;
  /** ISO-8601 UTC-tidspunkt. */
  endTime: string;
}

export interface BookingGroupWithSlots extends BookingGroup {
  slots: BookingSlot[];
}

export interface NewBookingGroupInput {
  id: string;
  kind: BookingKind;
  /** Utelatt betyr "customer" (vanlig kundebooking via bookingsiden). */
  source?: BookingSource;
  customerName: string;
  customerPhone: string;
  totalAmountOre: number;
  holdExpiresAt: string | null;
  note?: string | null;
  /** Kun for en turneringsbooking (se createTournamentBooking under) – hvem kunden møter. */
  opponentName?: string | null;
  /** Kun for en turneringsbooking – hvilken turnering (se Tournament over). */
  tournamentId?: string | null;
  /** Slots opprettes sammen med gruppen, atomisk (alt-eller-ingenting). */
  slots: Array<{ courtId: string; startTime: string; endTime: string }>;
}

export interface TimeRange {
  startTime: string;
  endTime: string;
}

/** Returnert når opprettelse feiler fordi ett eller flere tidsrom allerede er opptatt. */
export interface CreateConflict {
  ok: false;
  conflicts: TimeRange[];
}

export interface CreateSuccess {
  ok: true;
  group: BookingGroupWithSlots;
}

export type CreateResult = CreateConflict | CreateSuccess;

/**
 * "full" = vanlig administrator, kan gjøre alt i adminpanelet. "bookings_only"
 * = begrenset administrator, kan kun administrere Bookinger-fanen (se
 * middleware.ts for den faktiske håndhevingen av dette, og AdminNav.tsx for
 * hvilke faner som vises for en slik bruker). Lagret som tekst (ikke en ekte
 * Postgres-enum) – samme mønster som BookingStatus/BookingKind, se
 * database.types.ts.
 */
export type AdminRole = "full" | "bookings_only";

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  passwordSalt: string;
  role: AdminRole;
  createdAt: string;
}

/**
 * Én turnering (se app/admin/koder/turneringer/TournamentsManager.tsx) – admin
 * kan nå opprette flere, hver med sin egen kode/av-på-bryter/utløpsdato, i
 * stedet for ETT delt sett med innstillinger (den gamle modellen, se
 * historikken i lib/settings/tournament.ts). `code` trenger ikke være unik i
 * selve datalaget – API-ruten (app/api/admin/tournaments/route.ts) sjekker
 * kollisjon mot andre turneringer FØR den lagres, slik at to turneringer
 * aldri kan dele samme kode.
 */
export interface Tournament {
  id: string;
  name: string;
  code: string;
  active: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface ListGroupsFilter {
  /** ISO-dato (YYYY-MM-DD), inklusiv. */
  fromDate?: string;
  /** ISO-dato (YYYY-MM-DD), inklusiv. */
  toDate?: string;
}

export interface BookingRepository {
  /** Sjekker om NOEN av de gitte tidsrommene overlapper en aktiv (pending/confirmed) slot. */
  findConflicts(courtId: string, ranges: TimeRange[]): Promise<TimeRange[]>;

  /**
   * Oppretter en gruppe + tilhørende slots atomisk. Hvis ett eller flere av
   * tidsrommene har blitt tatt av noen andre i mellomtiden, opprettes
   * INGENTING, og konfliktene returneres slik at brukeren kan få beskjed.
   */
  createGroupWithSlots(input: NewBookingGroupInput): Promise<CreateResult>;

  getGroupByReference(reference: string): Promise<BookingGroupWithSlots | null>;

  /** Betinget statusoppdatering: lykkes kun hvis gjeldende status faktisk er `expectedCurrent`. */
  updateGroupStatus(
    reference: string,
    next: BookingStatus,
    expectedCurrent: BookingStatus
  ): Promise<BookingGroupWithSlots | null>;

  /** Setter status til "expired" på alle pending-grupper hvis hold har gått ut, og frigjør slottene deres. */
  expireStaleHolds(): Promise<void>;

  /** Brukes av admin-panelet. */
  listGroups(filter: ListGroupsFilter): Promise<BookingGroupWithSlots[]>;

  /** Admin avlyser en booking uansett status (frigjør slottene). Returnerer gruppen slik den var før avlysning, eller null hvis den ikke finnes. */
  cancelGroupAsAdmin(reference: string): Promise<BookingGroupWithSlots | null>;

  /**
   * Admin stenger banen i ett eller flere tidsrom (ingen betaling) – alt
   * samlet i ÉN gruppe/blokkering (samme mønster som en gjentakende booking
   * har én slot per uke), slik at f.eks. "hele dagen, hver dag 1.–5. juli"
   * sjekkes og opprettes atomisk: enten går ALLE dagene gjennom, eller
   * ingen, og konfliktene for hvert enkelt tidsrom rapporteres samlet.
   */
  createBlock(ranges: TimeRange[], note: string): Promise<CreateResult>;

  /**
   * Admin booker en eller flere tider direkte på vegne av en kunde (f.eks.
   * betalt kontant, eller bare registrert manuelt) – ett tidsrom gir `kind`
   * "single", flere tidsrom (samme ukedag/klokkeslett, én uke mellom hver –
   * se generateWeeklyDates) gir "recurring", akkurat som en vanlig
   * kundebooking (teller begge i statistikk/leaderboard som ekte bookinger, i
   * motsetning til "block"), og bindende med en gang (status "confirmed"),
   * ingen betaling involvert.
   */
  createAdminBooking(input: {
    customerName: string;
    customerPhone: string;
    totalAmountOre: number;
    ranges: TimeRange[];
  }): Promise<CreateResult>;

  /**
   * Oppretter en turneringsbooking – en enkelttime en spiller booker med en
   * admin-utstedt turneringskode i stedet for betaling (se
   * lib/settings/tournament.ts). Bindende med en gang (status "confirmed"),
   * ingen betaling involvert – samme "bindende med en gang"-mønster som
   * createBlock/createAdminBooking over. `source` er likevel "customer"
   * (det er jo spilleren selv som booket, bare uten å betale), IKKE "admin".
   */
  createTournamentBooking(input: {
    customerName: string;
    opponentName: string;
    /** Hvilken turnering koden hørte til (se findValidTournamentByCode i lib/settings/tournament.ts) – lagres på bookingen for at admin skal kunne se/filtrere kamper per turnering. */
    tournamentId: string | null;
    range: TimeRange;
  }): Promise<CreateResult>;

  /**
   * Admin endrer navn/telefon og/eller flytter klokkeslettet på en
   * eksisterende booking (brukt fra "Rediger" i dagens avtaleoversikt).
   * `range` flytter selve tidsrommet – kalleren har allerede sjekket at dette
   * kun skjer for kind "single" (en gjentakende rekke eller en blokkering har
   * ikke ett enkelt tidsrom å flytte). Konflikt sjekkes alltid EKSKLUSIV
   * bookingens egne nåværende slot(s), slik at "flytt til samme tid" eller
   * "ingen endring" aldri feiler på seg selv.
   */
  updateBookingDetails(
    id: string,
    patch: { customerName?: string; customerPhone?: string; range?: TimeRange }
  ): Promise<CreateResult>;

  /**
   * Admin aktiverer en AVLYST booking på nytt (status "cancelled" ->
   * "confirmed"), med valgfri samtidig endring av navn/telefon/tidsrom –
   * brukt fra samme "Rediger"-modal som updateBookingDetails. Kalleren
   * (API-ruten) har allerede sjekket at bookingen faktisk er "cancelled" og
   * at `range` kun sendes for kind "single". Sjekker konflikt mot ALLE
   * bookingens egne tidsrom (ikke bare det evt. nye) før den settes aktiv
   * igjen, siden noen andre kan ha rukket å booke akkurat denne tiden mens
   * den lå avlyst – akkurat som updateBookingDetails, ekskludert bookingens
   * egne (nåværende/nye) slot(s).
   */
  reactivateGroupAsAdmin(
    id: string,
    patch: { customerName?: string; customerPhone?: string; range?: TimeRange }
  ): Promise<CreateResult>;

  /**
   * Finner navnet brukt sist gang NOEN booket med dette mobilnummeret (på
   * tvers av nettlesere/enheter – i motsetning til navn/telefon som huskes
   * lokalt i brukerens egen nettleser via localStorage, se
   * REMEMBERED_NAME_KEY i app/BookingCalendar.tsx), slik at navnefeltet kan
   * fylles ut automatisk når man skriver inn et kjent nummer fra en helt ny
   * nettleser. Returnerer null hvis nummeret ikke finnes fra før.
   * Blokkeringer (kind "block") har ikke noe ekte kundenavn og ekskluderes.
   */
  findCustomerNameByPhone(phone: string): Promise<string | null>;

  getAdminByEmail(email: string): Promise<AdminUser | null>;
  createAdminUser(input: {
    email: string;
    name: string;
    passwordHash: string;
    passwordSalt: string;
    /** Utelatt betyr "full" – bakoverkompatibelt med det eksisterende create-admin-skriptet. */
    role?: AdminRole;
  }): Promise<AdminUser>;
  listAdminUsers(): Promise<AdminUser[]>;
  /** Oppdaterer passordet til en admin-bruker. Kalleren har allerede verifisert nåværende passord. */
  updateAdminPassword(id: string, passwordHash: string, passwordSalt: string): Promise<void>;

  /**
   * Endrer navn/e-post/rolle på en eksisterende admin-bruker (brukt fra
   * "Rediger" i Administratorer-fanen, se app/admin/account/AccountSettings.tsx).
   * Kalleren (API-ruten i app/api/admin/account/users/[id]/route.ts) har
   * allerede sjekket e-post-kollisjon, at man ikke endrer sin egen rolle, og
   * "siste fulle administrator"-regelen – dette laget utfører bare selve
   * endringen. Kaster hvis brukeren ikke finnes.
   */
  updateAdminUser(id: string, patch: { name?: string; email?: string; role?: AdminRole }): Promise<AdminUser>;

  /**
   * Sletter en admin-bruker. Kalleren har allerede sjekket at det ikke er
   * brukeren selv, og at det ikke er siste fulle administrator. Kaster hvis
   * brukeren ikke finnes.
   */
  deleteAdminUser(id: string): Promise<void>;

  /**
   * Turneringer (se Tournament over og
   * app/admin/koder/turneringer/TournamentsManager.tsx) – admin kan lage,
   * endre og slette flere turneringer. Kamper booket med en turnering som
   * senere slettes, beholdes (se "on delete set null" i migrasjonen) – kun
   * selve turneringsoppføringen (kode/av-på/utløpsdato) forsvinner.
   */
  listTournaments(): Promise<Tournament[]>;
  createTournament(input: { name: string; code: string; active: boolean; expiresAt: string | null }): Promise<Tournament>;
  updateTournament(
    id: string,
    patch: { name?: string; code?: string; active?: boolean; expiresAt?: string | null }
  ): Promise<Tournament>;
  deleteTournament(id: string): Promise<void>;

  /**
   * Enkel nøkkel/verdi-lagring for innstillinger satt via adminpanelet (f.eks.
   * Vipps-nøkler). Verdien er alltid en streng – ansvaret for evt. kryptering
   * av sensitivt innhold ligger hos kalleren (se lib/secrets.ts +
   * lib/settings/vippsSettings.ts), ikke i repository-laget.
   */
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}
