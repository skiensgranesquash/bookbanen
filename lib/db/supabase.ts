import "server-only";
import { addDays } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { COURT_ID, TIME_ZONE } from "@/lib/config";
import { getSupabaseAdmin } from "./supabaseClient";
import type {
  AdminRole,
  AdminUser,
  BookingGroup,
  BookingGroupWithSlots,
  BookingKind,
  BookingRepository,
  BookingSlot,
  BookingSource,
  BookingStatus,
  CreateResult,
  ListGroupsFilter,
  NewBookingGroupInput,
  TimeRange,
  Tournament,
} from "./types";

/**
 * Produksjonsdriver mot Supabase/Postgres. Se
 * supabase/migrations/0001_init.sql for skjemaet – overlappbeskyttelsen
 * håndheves der av en EXCLUDE-constraint (btree_gist), så selv om to
 * forespørsler skulle treffe samme millisekund, kan ikke begge lykkes.
 *
 * Denne fila er IKKE testet mot et ekte Supabase-prosjekt av Claude (ingen
 * nettverkstilgang til Supabase i byggemiljøet der dette ble skrevet) – den
 * lokale JSON-driveren (lib/db/local.ts) er derimot kjørt og testet direkte.
 * Kjør gjennom testplanen i README mot et ekte (test-)Supabase-prosjekt før
 * dette går i produksjon.
 */

const EXCLUSION_VIOLATION = "23P01";

interface GroupRow {
  id: string;
  status: BookingStatus;
  kind: BookingKind;
  /** Mangler på rader satt inn før denne kolonnen fantes – se migrations/0002_add_booking_source.sql (DEFAULT 'customer'). */
  source: BookingSource | null;
  customer_name: string;
  customer_phone: string;
  total_amount_ore: number;
  payment_reference: string;
  hold_expires_at: string | null;
  note: string | null;
  /** Mangler på rader satt inn før denne kolonnen fantes – se migrations/0006_add_tournament_fields.sql. */
  opponent_name: string | null;
  /** Hvilken turnering (se migrations/0007_add_tournaments_table.sql) – null for alle andre bookinger, og null hvis selve turneringen senere slettes ("on delete set null"). */
  tournament_id: string | null;
  created_at: string;
  updated_at: string;
}

interface SlotRow {
  id: string;
  group_id: string;
  court_id: string;
  start_time: string;
  end_time: string;
}

function mapGroup(row: GroupRow): BookingGroup {
  return {
    id: row.id,
    status: row.status,
    kind: row.kind,
    source: row.source ?? "customer",
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    totalAmountOre: row.total_amount_ore,
    paymentReference: row.payment_reference,
    holdExpiresAt: row.hold_expires_at,
    note: row.note,
    opponentName: row.opponent_name ?? null,
    tournamentId: row.tournament_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSlot(row: SlotRow): BookingSlot {
  return {
    id: row.id,
    groupId: row.group_id,
    courtId: row.court_id,
    startTime: row.start_time,
    endTime: row.end_time,
  };
}

interface TournamentRow {
  id: string;
  name: string;
  code: string;
  active: boolean;
  expires_at: string | null;
  created_at: string;
}

function mapTournament(row: TournamentRow): Tournament {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    active: row.active,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

async function fetchGroupWithSlots(reference: string): Promise<BookingGroupWithSlots | null> {
  const supabase = getSupabaseAdmin();

  const { data: groupRow, error: groupError } = await supabase
    .from("booking_groups")
    .select("*")
    .eq("id", reference)
    .maybeSingle();

  if (groupError) throw new Error(`Kunne ikke hente booking: ${groupError.message}`);
  if (!groupRow) return null;

  const { data: slotRows, error: slotsError } = await supabase
    .from("booking_slots")
    .select("*")
    .eq("group_id", reference);

  if (slotsError) throw new Error(`Kunne ikke hente tidsluker: ${slotsError.message}`);

  return {
    ...mapGroup(groupRow as GroupRow),
    slots: ((slotRows as SlotRow[] | null) ?? []).map(mapSlot),
  };
}

async function findConflictsImpl(
  courtId: string,
  ranges: TimeRange[],
  excludeGroupId?: string
): Promise<TimeRange[]> {
  if (ranges.length === 0) return [];
  const supabase = getSupabaseAdmin();

  const minStart = ranges.reduce((min, r) => (r.startTime < min ? r.startTime : min), ranges[0].startTime);
  const maxEnd = ranges.reduce((max, r) => (r.endTime > max ? r.endTime : max), ranges[0].endTime);

  let query = supabase
    .from("booking_slots")
    .select("start_time,end_time")
    .eq("court_id", courtId)
    .eq("blocks_time", true)
    .lt("start_time", maxEnd)
    .gt("end_time", minStart);

  // Ekskluderer bookingens EGNE slots fra konfliktsjekken – brukt når admin
  // flytter klokkeslettet på en eksisterende booking (updateBookingDetails),
  // slik at "flytt til samme tid" eller "ingen endring" aldri feiler på seg selv.
  if (excludeGroupId) query = query.neq("group_id", excludeGroupId);

  const { data, error } = await query;

  if (error) throw new Error(`Kunne ikke sjekke ledige tider: ${error.message}`);

  const activeSlots = (data as Array<{ start_time: string; end_time: string }> | null) ?? [];

  return ranges.filter((range) =>
    activeSlots.some(
      (slot) =>
        new Date(range.startTime).getTime() < new Date(slot.end_time).getTime() &&
        new Date(range.endTime).getTime() > new Date(slot.start_time).getTime()
    )
  );
}

async function insertGroupWithSlots(
  input: NewBookingGroupInput,
  initialStatus: BookingStatus
): Promise<CreateResult> {
  const supabase = getSupabaseAdmin();
  const courtId = input.slots[0]?.courtId ?? COURT_ID;
  const ranges = input.slots.map((s) => ({ startTime: s.startTime, endTime: s.endTime }));

  // Rask, hyggelig feilmelding i det vanlige tilfellet. Den faktiske
  // race-beskyttelsen er EXCLUDE-constraint-en i databasen (sjekket under).
  const preConflicts = await findConflictsImpl(courtId, ranges);
  if (preConflicts.length > 0) {
    return { ok: false, conflicts: preConflicts };
  }

  const { error: groupError } = await supabase.from("booking_groups").insert({
    id: input.id,
    status: initialStatus,
    kind: input.kind,
    source: input.source ?? "customer",
    customer_name: input.customerName,
    customer_phone: input.customerPhone,
    total_amount_ore: input.totalAmountOre,
    payment_reference: input.id,
    hold_expires_at: input.holdExpiresAt,
    note: input.note ?? null,
    opponent_name: input.opponentName ?? null,
    tournament_id: input.tournamentId ?? null,
  });

  if (groupError) {
    throw new Error(`Kunne ikke opprette booking-gruppe: ${groupError.message}`);
  }

  const { error: slotsError } = await supabase.from("booking_slots").insert(
    input.slots.map((s) => ({
      group_id: input.id,
      court_id: s.courtId,
      start_time: s.startTime,
      end_time: s.endTime,
    }))
  );

  if (slotsError) {
    // Rull tilbake gruppen igjen – se filkommentaren øverst om hvorfor dette
    // er trygt nok uten en ekte databasetransaksjon i vårt tilfelle.
    await supabase.from("booking_groups").delete().eq("id", input.id);

    if (slotsError.code === EXCLUSION_VIOLATION) {
      const conflicts = await findConflictsImpl(courtId, ranges);
      return { ok: false, conflicts: conflicts.length > 0 ? conflicts : ranges };
    }
    throw new Error(`Kunne ikke opprette tidsluker: ${slotsError.message}`);
  }

  const group = await fetchGroupWithSlots(input.id);
  if (!group) throw new Error("Uventet: fant ikke nyopprettet booking rett etter innsetting.");
  return { ok: true, group };
}

export const supabaseRepository: BookingRepository = {
  async findConflicts(courtId, ranges) {
    return findConflictsImpl(courtId, ranges);
  },

  async createGroupWithSlots(input) {
    return insertGroupWithSlots(input, "pending");
  },

  async getGroupByReference(reference) {
    return fetchGroupWithSlots(reference);
  },

  async updateGroupStatus(reference, next, expectedCurrent) {
    const supabase = getSupabaseAdmin();
    // Betinget oppdatering (kun hvis status faktisk fortsatt er
    // expectedCurrent). Hvis ingen rad matcher (fordi noen andre allerede
    // endret den), gjør vi ingenting og returnerer bare gjeldende sannhet
    // under – helt i tråd med kontrakten i lib/db/types.ts.
    const { error } = await supabase
      .from("booking_groups")
      .update({ status: next, hold_expires_at: null })
      .eq("id", reference)
      .eq("status", expectedCurrent);

    if (error) throw new Error(`Kunne ikke oppdatere bookingstatus: ${error.message}`);
    return fetchGroupWithSlots(reference);
  },

  async expireStaleHolds() {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("booking_groups")
      .update({ status: "expired", hold_expires_at: null })
      .eq("status", "pending")
      .lt("hold_expires_at", new Date().toISOString());

    if (error) throw new Error(`Klarte ikke å rydde opp utløpte holds: ${error.message}`);
  },

  async listGroups(filter: ListGroupsFilter) {
    const supabase = getSupabaseAdmin();

    // Begrenser hvor mye som faktisk hentes til et vindu rundt dagens dato
    // (se app/api/admin/bookings/route.ts, som alltid sender fromDate/
    // toDate) i stedet for ALT noensinne booket. Parameteret het tidligere
    // "_filter" MED VILJE (for å markere at det ikke ble brukt) og ble
    // fullstendig ignorert – adminpanelet hentet derfor hele
    // bookingshistorikken på HVERT eneste kall, og ble tregere og tregere jo
    // lenger klubben hadde brukt systemet. fromDate/toDate tolkes som lokale
    // (klubbens tidssone) kalenderdatoer, akkurat som "hele dagen"-
    // blokkeringer i app/api/admin/block/route.ts.
    let relevantGroupIds: string[] | null = null;
    if (filter.fromDate || filter.toDate) {
      let idsQuery = supabase.from("booking_slots").select("group_id");
      if (filter.fromDate) {
        idsQuery = idsQuery.gte("start_time", fromZonedTime(`${filter.fromDate}T00:00:00`, TIME_ZONE).toISOString());
      }
      if (filter.toDate) {
        const exclusiveEnd = addDays(fromZonedTime(`${filter.toDate}T00:00:00`, TIME_ZONE), 1);
        idsQuery = idsQuery.lt("start_time", exclusiveEnd.toISOString());
      }
      const { data: idRows, error: idError } = await idsQuery;
      if (idError) throw new Error(`Kunne ikke hente bookinger: ${idError.message}`);
      relevantGroupIds = Array.from(new Set((idRows ?? []).map((r) => r.group_id as string)));
      if (relevantGroupIds.length === 0) return [];
    }

    let groupsQuery = supabase.from("booking_groups").select("*");
    let slotsQuery = supabase.from("booking_slots").select("*");
    if (relevantGroupIds) {
      groupsQuery = groupsQuery.in("id", relevantGroupIds);
      slotsQuery = slotsQuery.in("group_id", relevantGroupIds);
    }

    const [{ data: groupRows, error: groupError }, { data: slotRows, error: slotError }] = await Promise.all([
      groupsQuery,
      slotsQuery,
    ]);

    if (groupError) throw new Error(`Kunne ikke hente bookinger: ${groupError.message}`);
    if (slotError) throw new Error(`Kunne ikke hente tidsluker: ${slotError.message}`);

    const slots = ((slotRows as SlotRow[] | null) ?? []).map(mapSlot);

    return ((groupRows as GroupRow[] | null) ?? [])
      .map(mapGroup)
      .map((group) => ({ ...group, slots: slots.filter((s) => s.groupId === group.id) }))
      .sort((a, b) => {
        const aStart = a.slots[0]?.startTime ?? a.createdAt;
        const bStart = b.slots[0]?.startTime ?? b.createdAt;
        return aStart.localeCompare(bStart);
      });
  },

  async cancelGroupAsAdmin(reference) {
    const existing = await fetchGroupWithSlots(reference);
    if (!existing) return null;

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("booking_groups")
      .update({ status: "cancelled", hold_expires_at: null })
      .eq("id", reference);

    if (error) throw new Error(`Kunne ikke avlyse booking: ${error.message}`);
    return existing;
  },

  async createBlock(ranges, note) {
    const { randomUUID } = await import("node:crypto");
    return insertGroupWithSlots(
      {
        id: randomUUID(),
        kind: "block",
        source: "admin",
        customerName: note,
        customerPhone: "",
        totalAmountOre: 0,
        holdExpiresAt: null,
        note,
        slots: ranges.map((range) => ({ courtId: COURT_ID, startTime: range.startTime, endTime: range.endTime })),
      },
      "confirmed"
    );
  },

  async createAdminBooking({ customerName, customerPhone, totalAmountOre, ranges }) {
    const { randomUUID } = await import("node:crypto");
    return insertGroupWithSlots(
      {
        id: randomUUID(),
        kind: ranges.length > 1 ? "recurring" : "single",
        source: "admin",
        customerName,
        customerPhone,
        totalAmountOre,
        holdExpiresAt: null,
        note: null,
        slots: ranges.map((range) => ({ courtId: COURT_ID, startTime: range.startTime, endTime: range.endTime })),
      },
      "confirmed"
    );
  },

  async createTournamentBooking({ customerName, opponentName, tournamentId, range }) {
    const { randomUUID } = await import("node:crypto");
    return insertGroupWithSlots(
      {
        id: randomUUID(),
        kind: "single",
        source: "customer",
        customerName,
        customerPhone: "",
        totalAmountOre: 0,
        holdExpiresAt: null,
        note: null,
        opponentName,
        tournamentId,
        slots: [{ courtId: COURT_ID, startTime: range.startTime, endTime: range.endTime }],
      },
      "confirmed"
    );
  },

  async updateBookingDetails(id, patch) {
    const existing = await fetchGroupWithSlots(id);
    if (!existing) return { ok: false, conflicts: [] };

    const supabase = getSupabaseAdmin();

    if (patch.range) {
      const slot = existing.slots[0];
      if (!slot) return { ok: false, conflicts: [] };

      const conflicts = await findConflictsImpl(
        slot.courtId,
        [{ startTime: patch.range.startTime, endTime: patch.range.endTime }],
        id
      );
      if (conflicts.length > 0) return { ok: false, conflicts };

      const { error: slotError } = await supabase
        .from("booking_slots")
        .update({ start_time: patch.range.startTime, end_time: patch.range.endTime })
        .eq("id", slot.id);
      if (slotError) throw new Error(`Kunne ikke flytte tidsrommet: ${slotError.message}`);
    }

    const groupPatch: { customer_name?: string; customer_phone?: string } = {};
    if (patch.customerName !== undefined) groupPatch.customer_name = patch.customerName;
    if (patch.customerPhone !== undefined) groupPatch.customer_phone = patch.customerPhone;

    if (Object.keys(groupPatch).length > 0) {
      const { error } = await supabase.from("booking_groups").update(groupPatch).eq("id", id);
      if (error) throw new Error(`Kunne ikke oppdatere booking: ${error.message}`);
    }

    const updated = await fetchGroupWithSlots(id);
    if (!updated) throw new Error("Uventet: fant ikke booking rett etter oppdatering.");
    return { ok: true, group: updated };
  },

  async reactivateGroupAsAdmin(id, patch) {
    const existing = await fetchGroupWithSlots(id);
    if (!existing) return { ok: false, conflicts: [] };

    const supabase = getSupabaseAdmin();

    // Kalleren (API-ruten) har allerede sjekket at et nytt tidsrom
    // (patch.range) kun sendes inn for kind "single" – da har gruppen
    // nøyaktig én slot. For andre kinds (f.eks. en gjentakende rekke)
    // sjekkes alle slottene som de er.
    const proposedRanges = patch.range
      ? [{ startTime: patch.range.startTime, endTime: patch.range.endTime }]
      : existing.slots.map((s) => ({ startTime: s.startTime, endTime: s.endTime }));

    const courtId = existing.slots[0]?.courtId ?? COURT_ID;
    const conflicts = await findConflictsImpl(courtId, proposedRanges, id);
    if (conflicts.length > 0) return { ok: false, conflicts };

    if (patch.range) {
      const slot = existing.slots[0];
      if (!slot) return { ok: false, conflicts: [] };
      const { error: slotError } = await supabase
        .from("booking_slots")
        .update({ start_time: patch.range.startTime, end_time: patch.range.endTime })
        .eq("id", slot.id);
      if (slotError) throw new Error(`Kunne ikke flytte tidsrommet: ${slotError.message}`);
    }

    const groupPatch: { status: string; customer_name?: string; customer_phone?: string } = {
      status: "confirmed",
    };
    if (patch.customerName !== undefined) groupPatch.customer_name = patch.customerName;
    if (patch.customerPhone !== undefined) groupPatch.customer_phone = patch.customerPhone;

    const { error } = await supabase.from("booking_groups").update(groupPatch).eq("id", id);
    if (error) throw new Error(`Kunne ikke aktivere booking på nytt: ${error.message}`);

    const updated = await fetchGroupWithSlots(id);
    if (!updated) throw new Error("Uventet: fant ikke booking rett etter aktivering.");
    return { ok: true, group: updated };
  },

  async findCustomerNameByPhone(phone) {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("booking_groups")
      .select("customer_name")
      .eq("customer_phone", phone)
      .neq("kind", "block")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`Kunne ikke slå opp kundenavn: ${error.message}`);
    return (data as { customer_name: string } | null)?.customer_name ?? null;
  },

  async getAdminByEmail(email) {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("admin_users")
      .select("*")
      .eq("email", email.toLowerCase())
      .maybeSingle();

    if (error) throw new Error(`Kunne ikke slå opp admin-bruker: ${error.message}`);
    if (!data) return null;

    const row = data as {
      id: string;
      email: string;
      name: string;
      password_hash: string;
      password_salt: string;
      role: string | null;
      created_at: string;
    };
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      passwordHash: row.password_hash,
      passwordSalt: row.password_salt,
      role: (row.role as AdminRole | null) ?? "full",
      createdAt: row.created_at,
    };
  },

  async createAdminUser(input) {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("admin_users")
      .insert({
        email: input.email.toLowerCase(),
        name: input.name,
        password_hash: input.passwordHash,
        password_salt: input.passwordSalt,
        role: input.role ?? "full",
      })
      .select()
      .single();

    if (error) throw new Error(`Kunne ikke opprette admin-bruker: ${error.message}`);
    const row = data as {
      id: string;
      email: string;
      name: string;
      password_hash: string;
      password_salt: string;
      role: string | null;
      created_at: string;
    };
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      passwordHash: row.password_hash,
      passwordSalt: row.password_salt,
      role: (row.role as AdminRole | null) ?? "full",
      createdAt: row.created_at,
    };
  },

  async listAdminUsers(): Promise<AdminUser[]> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("admin_users").select("*");
    if (error) throw new Error(`Kunne ikke liste admin-brukere: ${error.message}`);
    return (
      (data as Array<{
        id: string;
        email: string;
        name: string;
        password_hash: string;
        password_salt: string;
        role: string | null;
        created_at: string;
      }> | null) ?? []
    ).map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      passwordHash: row.password_hash,
      passwordSalt: row.password_salt,
      role: (row.role as AdminRole | null) ?? "full",
      createdAt: row.created_at,
    }));
  },

  async updateAdminPassword(id, passwordHash, passwordSalt) {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("admin_users")
      .update({ password_hash: passwordHash, password_salt: passwordSalt })
      .eq("id", id);
    if (error) throw new Error(`Kunne ikke oppdatere passord: ${error.message}`);
  },

  async updateAdminUser(id, patch) {
    const supabase = getSupabaseAdmin();
    // Satt sammen med spredning (ikke en mellomliggende Record<string,string>-
    // variabel) slik at TypeScript kan sjekke resultatet direkte mot den
    // håndskrevne admin_users-Update-typen i database.types.ts – samme
    // årsak som typecheck-feilen opponent_name ga i turneringsrunden.
    const { data, error } = await supabase
      .from("admin_users")
      .update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.email !== undefined ? { email: patch.email.toLowerCase() } : {}),
        ...(patch.role !== undefined ? { role: patch.role } : {}),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Kunne ikke oppdatere admin-bruker: ${error.message}`);
    const row = data as {
      id: string;
      email: string;
      name: string;
      password_hash: string;
      password_salt: string;
      role: string | null;
      created_at: string;
    };
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      passwordHash: row.password_hash,
      passwordSalt: row.password_salt,
      role: (row.role as AdminRole | null) ?? "full",
      createdAt: row.created_at,
    };
  },

  async deleteAdminUser(id) {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("admin_users").delete().eq("id", id);
    if (error) throw new Error(`Kunne ikke slette admin-bruker: ${error.message}`);
  },

  async listTournaments() {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("tournaments")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Kunne ikke liste turneringer: ${error.message}`);
    return ((data as TournamentRow[] | null) ?? []).map(mapTournament);
  },

  async createTournament(input) {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("tournaments")
      .insert({ name: input.name, code: input.code, active: input.active, expires_at: input.expiresAt })
      .select()
      .single();
    if (error) throw new Error(`Kunne ikke opprette turnering: ${error.message}`);
    return mapTournament(data as TournamentRow);
  },

  async updateTournament(id, patch) {
    const supabase = getSupabaseAdmin();
    // Satt sammen med spredning (samme mønster som updateAdminUser over) –
    // samme årsak som typecheck-feilen opponent_name ga i turneringsrunden.
    const { data, error } = await supabase
      .from("tournaments")
      .update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.code !== undefined ? { code: patch.code } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        ...(patch.expiresAt !== undefined ? { expires_at: patch.expiresAt } : {}),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Kunne ikke oppdatere turnering: ${error.message}`);
    return mapTournament(data as TournamentRow);
  },

  async deleteTournament(id) {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("tournaments").delete().eq("id", id);
    if (error) throw new Error(`Kunne ikke slette turnering: ${error.message}`);
  },

  async getSetting(key) {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
    if (error) throw new Error(`Kunne ikke lese innstilling: ${error.message}`);
    return (data as { value: string } | null)?.value ?? null;
  },

  async setSetting(key, value) {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) throw new Error(`Kunne ikke lagre innstilling: ${error.message}`);
  },
};
