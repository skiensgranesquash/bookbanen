import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AdminUser,
  BookingGroup,
  BookingGroupWithSlots,
  BookingRepository,
  BookingSlot,
  BookingStatus,
  CreateResult,
  ListGroupsFilter,
  NewBookingGroupInput,
  TimeRange,
} from "./types";

/**
 * Lokal, fil-basert database (data/db.json). Ment KUN for lokal utvikling
 * og testing – ingen eksterne kontoer, null oppsett, virker rett etter
 * `npm install`. Se lib/db/supabase.ts for produksjonsvarianten.
 *
 * IKKE bruk denne i produksjon: den håndterer ikke flere samtidige
 * serverinstanser (slik Vercel bruker), og filen skal ikke ligge i git
 * (den havner i .gitignore) siden den etter hvert inneholder ekte
 * navn/telefonnummer fra testbookinger.
 *
 * Samtidighet innad i ÉN Node-prosess (dvs. `npm run dev`) håndteres med en
 * enkel in-memory kø, slik at to forespørsler aldri kan lese-endre-skrive
 * filen om hverandre.
 */

interface DbShape {
  bookingGroups: BookingGroup[];
  bookingSlots: BookingSlot[];
  adminUsers: AdminUser[];
  settings: Record<string, string>;
}

const DB_PATH = path.join(process.cwd(), "data", "db.json");

function emptyDb(): DbShape {
  return { bookingGroups: [], bookingSlots: [], adminUsers: [], settings: {} };
}

/** Eldre lagrede bookinger (fra før `source`-feltet fantes) mangler feltet – de regnes som vanlige kundebookinger. */
function normalizeGroup(group: BookingGroup): BookingGroup {
  return { ...group, source: group.source ?? "customer" };
}

async function loadDb(): Promise<DbShape> {
  try {
    const text = await readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(text) as Partial<DbShape>;
    return {
      bookingGroups: (parsed.bookingGroups ?? []).map(normalizeGroup),
      bookingSlots: parsed.bookingSlots ?? [],
      adminUsers: parsed.adminUsers ?? [],
      settings: parsed.settings ?? {},
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyDb();
    }
    throw err;
  }
}

async function saveDb(db: DbShape): Promise<void> {
  await mkdir(path.dirname(DB_PATH), { recursive: true });
  await writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

// Enkel async-kø: alt som rører filen kjøres etter tur, aldri samtidig.
let queue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  // Svelg feil i køen selv (ellers stopper køen opp for alltid etter én feil),
  // men la feilen fortsatt kastes videre til kalleren av withLock.
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() &&
    new Date(aEnd).getTime() > new Date(bStart).getTime();
}

const ACTIVE_STATUSES: BookingStatus[] = ["pending", "confirmed"];

function toGroupWithSlots(group: BookingGroup, allSlots: BookingSlot[]): BookingGroupWithSlots {
  return { ...group, slots: allSlots.filter((s) => s.groupId === group.id) };
}

function findConflictsIn(
  db: DbShape,
  courtId: string,
  ranges: TimeRange[],
  excludeGroupId?: string
): TimeRange[] {
  const activeGroupIds = new Set(
    db.bookingGroups
      .filter((g) => ACTIVE_STATUSES.includes(g.status) && g.id !== excludeGroupId)
      .map((g) => g.id)
  );
  const activeSlots = db.bookingSlots.filter(
    (s) => s.courtId === courtId && activeGroupIds.has(s.groupId)
  );

  return ranges.filter((range) =>
    activeSlots.some((slot) => rangesOverlap(range.startTime, range.endTime, slot.startTime, slot.endTime))
  );
}

async function createGroupWithSlotsInternal(
  db: DbShape,
  input: NewBookingGroupInput
): Promise<{ db: DbShape; result: CreateResult }> {
  const ranges = input.slots.map((s) => ({ startTime: s.startTime, endTime: s.endTime }));
  const courtId = input.slots[0]?.courtId ?? "1";
  const conflicts = findConflictsIn(db, courtId, ranges);

  if (conflicts.length > 0) {
    return { db, result: { ok: false, conflicts } };
  }

  const now = new Date().toISOString();
  const group: BookingGroup = {
    id: input.id,
    status: "pending",
    kind: input.kind,
    source: input.source ?? "customer",
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    totalAmountOre: input.totalAmountOre,
    paymentReference: input.id,
    holdExpiresAt: input.holdExpiresAt,
    note: input.note ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const slots: BookingSlot[] = input.slots.map((s) => ({
    id: randomUUID(),
    groupId: group.id,
    courtId: s.courtId,
    startTime: s.startTime,
    endTime: s.endTime,
  }));

  const nextDb: DbShape = {
    ...db,
    bookingGroups: [...db.bookingGroups, group],
    bookingSlots: [...db.bookingSlots, ...slots],
  };

  return { db: nextDb, result: { ok: true, group: toGroupWithSlots(group, slots) } };
}

export const localRepository: BookingRepository = {
  async findConflicts(courtId, ranges) {
    const db = await loadDb();
    return findConflictsIn(db, courtId, ranges);
  },

  async createGroupWithSlots(input) {
    return withLock(async () => {
      const db = await loadDb();
      const { db: nextDb, result } = await createGroupWithSlotsInternal(db, input);
      if (result.ok) {
        await saveDb(nextDb);
      }
      return result;
    });
  },

  async getGroupByReference(reference) {
    const db = await loadDb();
    const group = db.bookingGroups.find((g) => g.id === reference);
    if (!group) return null;
    return toGroupWithSlots(group, db.bookingSlots);
  },

  async updateGroupStatus(reference, next, expectedCurrent) {
    return withLock(async () => {
      const db = await loadDb();
      const group = db.bookingGroups.find((g) => g.id === reference);
      if (!group) return null;

      if (group.status !== expectedCurrent) {
        // Noen andre har allerede endret status (f.eks. en samtidig webhook-
        // levering) – returner gjeldende sannhet i stedet for å overskrive.
        return toGroupWithSlots(group, db.bookingSlots);
      }

      group.status = next;
      group.updatedAt = new Date().toISOString();
      if (next !== "pending") group.holdExpiresAt = null;

      await saveDb(db);
      return toGroupWithSlots(group, db.bookingSlots);
    });
  },

  async expireStaleHolds() {
    await withLock(async () => {
      const db = await loadDb();
      const now = Date.now();
      let changed = false;

      for (const group of db.bookingGroups) {
        if (
          group.status === "pending" &&
          group.holdExpiresAt &&
          new Date(group.holdExpiresAt).getTime() < now
        ) {
          group.status = "expired";
          group.holdExpiresAt = null;
          group.updatedAt = new Date().toISOString();
          changed = true;
        }
      }

      if (changed) await saveDb(db);
    });
  },

  async listGroups(_filter: ListGroupsFilter) {
    // Datasettet for én bane er lite nok til at vi bare returnerer alt og
    // lar admin-UI-et filtrere/sortere selv – slipper tidssone-fallgruver
    // ved å filtrere på dato her.
    const db = await loadDb();
    return db.bookingGroups
      .map((g) => toGroupWithSlots(g, db.bookingSlots))
      .sort((a, b) => {
        const aStart = a.slots[0]?.startTime ?? a.createdAt;
        const bStart = b.slots[0]?.startTime ?? b.createdAt;
        return aStart.localeCompare(bStart);
      });
  },

  async cancelGroupAsAdmin(reference) {
    return withLock(async () => {
      const db = await loadDb();
      const group = db.bookingGroups.find((g) => g.id === reference);
      if (!group) return null;

      const snapshotBeforeCancel = toGroupWithSlots(group, db.bookingSlots);

      group.status = "cancelled";
      group.holdExpiresAt = null;
      group.updatedAt = new Date().toISOString();

      await saveDb(db);
      return snapshotBeforeCancel;
    });
  },

  async createBlock(ranges, note) {
    return withLock(async () => {
      const db = await loadDb();
      const { db: nextDb, result } = await createGroupWithSlotsInternal(db, {
        id: randomUUID(),
        kind: "block",
        source: "admin",
        customerName: note,
        customerPhone: "",
        totalAmountOre: 0,
        holdExpiresAt: null,
        note,
        slots: ranges.map((range) => ({ courtId: "1", startTime: range.startTime, endTime: range.endTime })),
      });

      if (result.ok) {
        // Blokkeringer er bindende med en gang – ingen betaling å vente på.
        const created = nextDb.bookingGroups.find((g) => g.id === result.group.id);
        if (created) created.status = "confirmed";
        result.group.status = "confirmed";
        await saveDb(nextDb);
      }

      return result;
    });
  },

  async createAdminBooking({ customerName, customerPhone, totalAmountOre, range }) {
    return withLock(async () => {
      const db = await loadDb();
      const { db: nextDb, result } = await createGroupWithSlotsInternal(db, {
        id: randomUUID(),
        kind: "single",
        source: "admin",
        customerName,
        customerPhone,
        totalAmountOre,
        holdExpiresAt: null,
        note: null,
        slots: [{ courtId: "1", startTime: range.startTime, endTime: range.endTime }],
      });

      if (result.ok) {
        // Bindende med en gang – admin booker uten betaling, akkurat som en blokkering.
        const created = nextDb.bookingGroups.find((g) => g.id === result.group.id);
        if (created) created.status = "confirmed";
        result.group.status = "confirmed";
        await saveDb(nextDb);
      }

      return result;
    });
  },

  async updateBookingDetails(id, patch) {
    return withLock(async () => {
      const db = await loadDb();
      const group = db.bookingGroups.find((g) => g.id === id);
      if (!group) return { ok: false, conflicts: [] };

      if (patch.range) {
        const slot = db.bookingSlots.find((s) => s.groupId === id);
        if (!slot) return { ok: false, conflicts: [] };

        const conflicts = findConflictsIn(
          db,
          slot.courtId,
          [{ startTime: patch.range.startTime, endTime: patch.range.endTime }],
          id
        );
        if (conflicts.length > 0) return { ok: false, conflicts };

        slot.startTime = patch.range.startTime;
        slot.endTime = patch.range.endTime;
      }

      if (patch.customerName !== undefined) group.customerName = patch.customerName;
      if (patch.customerPhone !== undefined) group.customerPhone = patch.customerPhone;
      group.updatedAt = new Date().toISOString();

      await saveDb(db);
      return { ok: true, group: toGroupWithSlots(group, db.bookingSlots) };
    });
  },

  async reactivateGroupAsAdmin(id, patch) {
    return withLock(async () => {
      const db = await loadDb();
      const group = db.bookingGroups.find((g) => g.id === id);
      if (!group) return { ok: false, conflicts: [] };

      const slots = db.bookingSlots.filter((s) => s.groupId === id);
      if (slots.length === 0) return { ok: false, conflicts: [] };

      // Kalleren (API-ruten) har allerede sjekket at et nytt tidsrom
      // (patch.range) kun sendes inn for kind "single" – da har gruppen
      // nøyaktig én slot, så det er trygt å anta slots[0] under. For andre
      // kinds (f.eks. en gjentakende rekke) sjekkes alle slottene som de er.
      const proposedRanges = patch.range
        ? [{ startTime: patch.range.startTime, endTime: patch.range.endTime }]
        : slots.map((s) => ({ startTime: s.startTime, endTime: s.endTime }));

      const conflicts = findConflictsIn(db, slots[0].courtId, proposedRanges, id);
      if (conflicts.length > 0) return { ok: false, conflicts };

      if (patch.range) {
        slots[0].startTime = patch.range.startTime;
        slots[0].endTime = patch.range.endTime;
      }

      if (patch.customerName !== undefined) group.customerName = patch.customerName;
      if (patch.customerPhone !== undefined) group.customerPhone = patch.customerPhone;
      group.status = "confirmed";
      group.updatedAt = new Date().toISOString();

      await saveDb(db);
      return { ok: true, group: toGroupWithSlots(group, db.bookingSlots) };
    });
  },

  async getAdminByEmail(email) {
    const db = await loadDb();
    return db.adminUsers.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  },

  async createAdminUser(input) {
    return withLock(async () => {
      const db = await loadDb();
      const user: AdminUser = {
        id: randomUUID(),
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash,
        passwordSalt: input.passwordSalt,
        createdAt: new Date().toISOString(),
      };
      db.adminUsers.push(user);
      await saveDb(db);
      return user;
    });
  },

  async listAdminUsers() {
    const db = await loadDb();
    return db.adminUsers;
  },

  async updateAdminPassword(id, passwordHash, passwordSalt) {
    return withLock(async () => {
      const db = await loadDb();
      const user = db.adminUsers.find((u) => u.id === id);
      if (!user) throw new Error("Fant ingen admin-bruker med denne iden.");
      user.passwordHash = passwordHash;
      user.passwordSalt = passwordSalt;
      await saveDb(db);
    });
  },

  async getSetting(key) {
    const db = await loadDb();
    return db.settings[key] ?? null;
  },

  async setSetting(key, value) {
    return withLock(async () => {
      const db = await loadDb();
      db.settings[key] = value;
      await saveDb(db);
    });
  },
};
