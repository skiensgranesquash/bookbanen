import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(".").resolve()
P_TYPES = ROOT / "lib" / "db" / "types.ts"
P_LOCAL = ROOT / "lib" / "db" / "local.ts"
P_SUPABASE = ROOT / "lib" / "db" / "supabase.ts"
P_BI = ROOT / "app" / "admin" / "BookingsInsights.tsx"
P_MANUAL = ROOT / "app" / "api" / "admin" / "bookings" / "manual" / "route.ts"


def apply_regex(path, pattern, new, label, already_marker):
    text = path.read_text(encoding="utf-8")
    if already_marker in text:
        print(f"[already done] {label}")
        return True
    matches = list(re.finditer(pattern, text, re.S))
    if len(matches) == 0:
        print(f"[SKIPPED - not found] {label}")
        return False
    if len(matches) > 1:
        print(f"[SKIPPED - ambiguous, {len(matches)} matches] {label}")
        return False
    m = matches[0]
    text = text[: m.start()] + new + text[m.end() :]
    path.write_text(text, encoding="utf-8")
    print(f"[OK] {label}")
    return True


def write_full_file(path, new_text, label, already_marker):
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    if already_marker in text:
        print(f"[already done] {label}")
        return True
    path.write_text(new_text, encoding="utf-8")
    print(f"[OK] {label} (full file replaced)")
    return True


ok = True

ok = apply_regex(
    P_TYPES,
    "\\ \\ /\\*\\*\\\n\\ \\ \\ \\*\\ Admin\\ booker\\ en\\ tid\\ direkte\\ p.*?\\ vegne\\ av\\ en\\ kunde\\ \\(f\\.eks\\.\\ betalt\\ kontant,\\\n\\ \\ \\ \\*\\ eller\\ bare\\ registrert\\ manuelt\\)\\ .*?\\ `kind`\\ er\\ alltid\\ \"single\"\\ \\(teller\\ i\\\n\\ \\ \\ \\*\\ statistikk/leaderboard\\ som\\ en\\ ekte\\ booking,\\ i\\ motsetning\\ til\\ \"block\"\\),\\\n\\ \\ \\ \\*\\ og\\ bindende\\ med\\ en\\ gang\\ \\(status\\ \"confirmed\"\\),\\ ingen\\ betaling\\ involvert\\.\\\n\\ \\ \\ \\*/\\\n\\ \\ createAdminBooking\\(input:\\ \\{\\\n\\ \\ \\ \\ customerName:\\ string;\\\n\\ \\ \\ \\ customerPhone:\\ string;\\\n\\ \\ \\ \\ totalAmountOre:\\ number;\\\n\\ \\ \\ \\ range:\\ TimeRange;\\\n\\ \\ \\}\\):\\ Promise<CreateResult>;",
    "  /**\n   * Admin booker en eller flere tider direkte p\u00e5 vegne av en kunde (f.eks.\n   * betalt kontant, eller bare registrert manuelt) \u2013 ett tidsrom gir `kind`\n   * \"single\", flere tidsrom (samme ukedag/klokkeslett, \u00e9n uke mellom hver \u2013\n   * se generateWeeklyDates) gir \"recurring\", akkurat som en vanlig\n   * kundebooking (teller begge i statistikk/leaderboard som ekte bookinger, i\n   * motsetning til \"block\"), og bindende med en gang (status \"confirmed\"),\n   * ingen betaling involvert.\n   */\n  createAdminBooking(input: {\n    customerName: string;\n    customerPhone: string;\n    totalAmountOre: number;\n    ranges: TimeRange[];\n  }): Promise<CreateResult>;",
    "types-createAdminBooking",
    "ranges: TimeRange[];",
) and ok

ok = apply_regex(
    P_LOCAL,
    "\\ \\ async\\ createAdminBooking\\(\\{\\ customerName,\\ customerPhone,\\ totalAmountOre,\\ range\\ \\}\\)\\ \\{\\\n\\ \\ \\ \\ return\\ withLock\\(async\\ \\(\\)\\ =>\\ \\{\\\n\\ \\ \\ \\ \\ \\ const\\ db\\ =\\ await\\ loadDb\\(\\);\\\n\\ \\ \\ \\ \\ \\ const\\ \\{\\ db:\\ nextDb,\\ result\\ \\}\\ =\\ await\\ createGroupWithSlotsInternal\\(db,\\ \\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ id:\\ randomUUID\\(\\),\\\n\\ \\ \\ \\ \\ \\ \\ \\ kind:\\ \"single\",\\\n\\ \\ \\ \\ \\ \\ \\ \\ source:\\ \"admin\",\\\n\\ \\ \\ \\ \\ \\ \\ \\ customerName,\\\n\\ \\ \\ \\ \\ \\ \\ \\ customerPhone,\\\n\\ \\ \\ \\ \\ \\ \\ \\ totalAmountOre,\\\n\\ \\ \\ \\ \\ \\ \\ \\ holdExpiresAt:\\ null,\\\n\\ \\ \\ \\ \\ \\ \\ \\ note:\\ null,\\\n\\ \\ \\ \\ \\ \\ \\ \\ slots:\\ \\[\\{\\ courtId:\\ \"1\",\\ startTime:\\ range\\.startTime,\\ endTime:\\ range\\.endTime\\ \\}\\],\\\n\\ \\ \\ \\ \\ \\ \\}\\);\\\n\\\n\\ \\ \\ \\ \\ \\ if\\ \\(result\\.ok\\)\\ \\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ //\\ Bindende\\ med\\ en\\ gang\\ .*?\\ admin\\ booker\\ uten\\ betaling,\\ akkurat\\ som\\ en\\ blokkering\\.\\\n\\ \\ \\ \\ \\ \\ \\ \\ const\\ created\\ =\\ nextDb\\.bookingGroups\\.find\\(\\(g\\)\\ =>\\ g\\.id\\ ===\\ result\\.group\\.id\\);\\\n\\ \\ \\ \\ \\ \\ \\ \\ if\\ \\(created\\)\\ created\\.status\\ =\\ \"confirmed\";\\\n\\ \\ \\ \\ \\ \\ \\ \\ result\\.group\\.status\\ =\\ \"confirmed\";\\\n\\ \\ \\ \\ \\ \\ \\ \\ await\\ saveDb\\(nextDb\\);\\\n\\ \\ \\ \\ \\ \\ \\}\\\n\\\n\\ \\ \\ \\ \\ \\ return\\ result;\\\n\\ \\ \\ \\ \\}\\);\\\n\\ \\ \\},",
    "  async createAdminBooking({ customerName, customerPhone, totalAmountOre, ranges }) {\n    return withLock(async () => {\n      const db = await loadDb();\n      const { db: nextDb, result } = await createGroupWithSlotsInternal(db, {\n        id: randomUUID(),\n        kind: ranges.length > 1 ? \"recurring\" : \"single\",\n        source: \"admin\",\n        customerName,\n        customerPhone,\n        totalAmountOre,\n        holdExpiresAt: null,\n        note: null,\n        slots: ranges.map((range) => ({ courtId: \"1\", startTime: range.startTime, endTime: range.endTime })),\n      });\n\n      if (result.ok) {\n        // Bindende med en gang \u2013 admin booker uten betaling, akkurat som en blokkering.\n        const created = nextDb.bookingGroups.find((g) => g.id === result.group.id);\n        if (created) created.status = \"confirmed\";\n        result.group.status = \"confirmed\";\n        await saveDb(nextDb);\n      }\n\n      return result;\n    });\n  },",
    "local-createAdminBooking",
    "kind: ranges.length > 1 ? \"recurring\" : \"single\",\n        source: \"admin\",\n        customerName,\n        customerPhone,\n        totalAmountOre,\n        holdExpiresAt: null,\n        note: null,\n        slots: ranges.map((range) => ({ courtId: \"1\"",
) and ok

ok = apply_regex(
    P_SUPABASE,
    "\\ \\ async\\ createAdminBooking\\(\\{\\ customerName,\\ customerPhone,\\ totalAmountOre,\\ range\\ \\}\\)\\ \\{\\\n\\ \\ \\ \\ const\\ \\{\\ randomUUID\\ \\}\\ =\\ await\\ import\\(\"node:crypto\"\\);\\\n\\ \\ \\ \\ return\\ insertGroupWithSlots\\(\\\n\\ \\ \\ \\ \\ \\ \\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ id:\\ randomUUID\\(\\),\\\n\\ \\ \\ \\ \\ \\ \\ \\ kind:\\ \"single\",\\\n\\ \\ \\ \\ \\ \\ \\ \\ source:\\ \"admin\",\\\n\\ \\ \\ \\ \\ \\ \\ \\ customerName,\\\n\\ \\ \\ \\ \\ \\ \\ \\ customerPhone,\\\n\\ \\ \\ \\ \\ \\ \\ \\ totalAmountOre,\\\n\\ \\ \\ \\ \\ \\ \\ \\ holdExpiresAt:\\ null,\\\n\\ \\ \\ \\ \\ \\ \\ \\ note:\\ null,\\\n\\ \\ \\ \\ \\ \\ \\ \\ slots:\\ \\[\\{\\ courtId:\\ COURT_ID,\\ startTime:\\ range\\.startTime,\\ endTime:\\ range\\.endTime\\ \\}\\],\\\n\\ \\ \\ \\ \\ \\ \\},\\\n\\ \\ \\ \\ \\ \\ \"confirmed\"\\\n\\ \\ \\ \\ \\);\\\n\\ \\ \\},",
    "  async createAdminBooking({ customerName, customerPhone, totalAmountOre, ranges }) {\n    const { randomUUID } = await import(\"node:crypto\");\n    return insertGroupWithSlots(\n      {\n        id: randomUUID(),\n        kind: ranges.length > 1 ? \"recurring\" : \"single\",\n        source: \"admin\",\n        customerName,\n        customerPhone,\n        totalAmountOre,\n        holdExpiresAt: null,\n        note: null,\n        slots: ranges.map((range) => ({ courtId: COURT_ID, startTime: range.startTime, endTime: range.endTime })),\n      },\n      \"confirmed\"\n    );\n  },",
    "supabase-createAdminBooking",
    "kind: ranges.length > 1 ? \"recurring\" : \"single\",\n        source: \"admin\",\n        customerName,\n        customerPhone,\n        totalAmountOre,\n        holdExpiresAt: null,\n        note: null,\n        slots: ranges.map((range) => ({ courtId: COURT_ID",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ const\\ \\[manualName,\\ setManualName\\]\\ =\\ useState\\(\"\"\\);\\\n\\ \\ const\\ \\[manualPhone,\\ setManualPhone\\]\\ =\\ useState\\(\"\"\\);\\\n\\ \\ const\\ \\[manualSubmitting,\\ setManualSubmitting\\]\\ =\\ useState\\(false\\);\\\n\\ \\ const\\ \\[manualError,\\ setManualError\\]\\ =\\ useState<string\\ \\|\\ null>\\(null\\);",
    "  const [manualName, setManualName] = useState(\"\");\n  const [manualPhone, setManualPhone] = useState(\"\");\n  // Gjentakende booking (kun relevant i \"create\"-modus \u2013 en redigering har\n  // alltid kun ett eksisterende tidsrom \u00e5 flytte, se modal.kind over) \u2013 samme\n  // ukedag/klokkeslett hver uke fra og med modal.date, se\n  // app/api/admin/bookings/manual/route.ts.\n  const [manualRecurring, setManualRecurring] = useState(false);\n  const [manualWeeks, setManualWeeks] = useState(4);\n  const [manualSubmitting, setManualSubmitting] = useState(false);\n  const [manualError, setManualError] = useState<string | null>(null);",
    "bi-state",
    "const [manualRecurring, setManualRecurring] = useState(false);",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ function\\ openCreateModal\\(dateStr:\\ string\\)\\ \\{\\\n\\ \\ \\ \\ setModal\\(\\{\\ mode:\\ \"create\",\\ date:\\ dateStr\\ \\}\\);\\\n\\ \\ \\ \\ setManualTime\\(\"\"\\);\\\n\\ \\ \\ \\ setManualDurationMinutes\\(60\\);\\\n\\ \\ \\ \\ setManualName\\(\"\"\\);\\\n\\ \\ \\ \\ setManualPhone\\(\"\"\\);\\\n\\ \\ \\ \\ setManualError\\(null\\);\\\n\\ \\ \\}",
    "  function openCreateModal(dateStr: string) {\n    setModal({ mode: \"create\", date: dateStr });\n    setManualTime(\"\");\n    setManualDurationMinutes(60);\n    setManualName(\"\");\n    setManualPhone(\"\");\n    setManualRecurring(false);\n    setManualWeeks(4);\n    setManualError(null);\n  }",
    "bi-open-create-modal-reset",
    "setManualRecurring(false);\n    setManualWeeks(4);",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ body:\\ JSON\\.stringify\\(\\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ date:\\ modal\\.date,\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ time:\\ manualTime,\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ name:\\ manualName,\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ phone:\\ manualPhone,\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ durationMinutes:\\ manualDurationMinutes,\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\}\\),",
    "          body: JSON.stringify({\n            date: modal.date,\n            time: manualTime,\n            name: manualName,\n            phone: manualPhone,\n            durationMinutes: manualDurationMinutes,\n            weeks: manualRecurring ? manualWeeks : 1,\n          }),",
    "bi-submit-body-weeks",
    "weeks: manualRecurring ? manualWeeks : 1,",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ 1\\ time\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ </button>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ </div>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\)\\}\\\n\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\{needsSlotGrid\\ \\&\\&\\ \\(",
    "                  1 time\n                </button>\n              </div>\n            )}\n\n            {modal.mode === \"create\" && (\n              <div style={{ marginTop: 10 }}>\n                <label className={styles.checkboxOption}>\n                  <input\n                    type=\"checkbox\"\n                    checked={manualRecurring}\n                    onChange={(e) => setManualRecurring(e.target.checked)}\n                  />\n                  Gjentakende \u2013 samme ukedag/klokkeslett hver uke\n                </label>\n                {manualRecurring && (\n                  <div className={styles.formRow} style={{ marginTop: 10 }}>\n                    <label htmlFor=\"manual-weeks\">Antall uker (inkl. denne)</label>\n                    <input\n                      id=\"manual-weeks\"\n                      type=\"number\"\n                      min={1}\n                      max={MAX_RECURRING_WEEKS}\n                      value={manualWeeks}\n                      onChange={(e) =>\n                        setManualWeeks(Math.max(1, Math.min(MAX_RECURRING_WEEKS, Number(e.target.value) || 1)))\n                      }\n                    />\n                  </div>\n                )}\n              </div>\n            )}\n\n            {needsSlotGrid && (",
    "bi-recurring-jsx",
    "Gjentakende \u2013 samme ukedag/klokkeslett hver uke",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ :\\ modal\\.mode\\ ===\\ \"create\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\?\\ \"Book\\ tiden\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ :\\ modal\\.status\\ ===\\ \"cancelled\"",
    "                    : modal.mode === \"create\"\n                      ? manualRecurring\n                        ? \"Book rekken\"\n                        : \"Book tiden\"\n                      : modal.status === \"cancelled\"",
    "bi-submit-button-label",
    "? \"Book rekken\"",
) and ok

ok = write_full_file(
    P_MANUAL,
    "import { NextRequest, NextResponse } from \"next/server\";\nimport { getRepository } from \"@/lib/db\";\nimport { generateWeeklyDates, isValidBookingDateString, isWithinOpeningHours, occurrenceRange } from \"@/lib/slots\";\nimport { normalizeNorwegianMobile } from \"@/lib/phone\";\nimport {\n  durationMinutesToSlots,\n  isBookableDurationMinutes,\n  MAX_RECURRING_WEEKS,\n  type BookingDurationMinutes,\n} from \"@/lib/config\";\nimport { effectiveHoursForDate, getHoursContext } from \"@/lib/settings/openingHours\";\nimport { getPricingSettings, priceForDuration } from \"@/lib/settings/pricing\";\n\nexport const dynamic = \"force-dynamic\";\n\ninterface ManualBookingBody {\n  date?: string;\n  time?: string;\n  name?: string;\n  phone?: string;\n  /** 30 eller 60 (minutter) \u2013 utelatt betyr 60, den gamle, faste varigheten. */\n  durationMinutes?: number;\n  /** Antall uker i en gjentakende rekke (samme ukedag/klokkeslett hver uke \u2013 \"date\" er F\u00d8RSTE forekomst). Utelatt eller 1 betyr en vanlig enkeltbooking. */\n  weeks?: number;\n}\n\n/**\n * POST /api/admin/bookings/manual\n * Body: { date: \"YYYY-MM-DD\", time: \"HH:mm\", name: string, phone?: string, durationMinutes?: 30 | 60, weeks?: number }\n *\n * Admin booker en eller flere tider direkte p\u00e5 vegne av en kunde (f.eks.\n * betalt kontant, eller bare registrert manuelt) \u2013 ingen betaling involvert,\n * bindende med en gang. Varigheten er 30 minutter eller 1 time, samme valg\n * som en vanlig booking har (se BOOKABLE_DURATIONS_MINUTES i lib/config.ts)\n * \u2013 1 time er fortsatt forh\u00e5ndsvalgt som standard, siden det var den gamle,\n * faste oppf\u00f8rselen.\n *\n * \"weeks\" > 1 gj\u00f8r bookingen gjentakende \u2013 samme ukedag/klokkeslett hver uke\n * fra og med \"date\", akkurat som den offentlige bookingsiden (se\n * app/api/squash/bookings/route.ts), men UTEN kundens egen\n * recurringCutoffDate/maxWeeks-grense (se lib/settings/recurringLimit.ts) \u2013\n * den grensen er en selvbetjenings-brems for kunder, ikke noe admin selv\n * skal v\u00e6re begrenset av. Fortsatt begrenset av det globale\n * MAX_RECURRING_WEEKS-taket under, som en siste sikkerhetsgrense.\n */\nexport async function POST(request: NextRequest) {\n  let body: ManualBookingBody;\n  try {\n    body = (await request.json()) as ManualBookingBody;\n  } catch {\n    return NextResponse.json({ error: \"Ugyldig foresp\u00f8rsel.\" }, { status: 400 });\n  }\n\n  const { date, time } = body;\n  const name = body.name?.trim() ?? \"\";\n  const rawPhone = body.phone?.trim() ?? \"\";\n\n  if (!date || !isValidBookingDateString(date)) {\n    return NextResponse.json({ error: \"Ugyldig dato.\" }, { status: 400 });\n  }\n  if (!time || !/^\\d{2}:\\d{2}$/.test(time)) {\n    return NextResponse.json({ error: \"Ugyldig klokkeslett.\" }, { status: 400 });\n  }\n\n  const weeks = Number(body.weeks ?? 1);\n  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_RECURRING_WEEKS) {\n    return NextResponse.json({ error: `Antall uker m\u00e5 v\u00e6re mellom 1 og ${MAX_RECURRING_WEEKS}.` }, { status: 400 });\n  }\n\n  const durationMinutes: BookingDurationMinutes = isBookableDurationMinutes(body.durationMinutes)\n    ? body.durationMinutes\n    : 60;\n\n  if (name.length < 2 || name.length > 100) {\n    return NextResponse.json({ error: \"Navn m\u00e5 v\u00e6re mellom 2 og 100 tegn.\" }, { status: 400 });\n  }\n\n  // Telefon er valgfritt for admin (i motsetning til den offentlige\n  // bookingsiden) \u2013 men hvis noe er skrevet inn, m\u00e5 det se ut som et ekte\n  // norsk mobilnummer, slik at det stemmer overens med leaderboard/statistikk.\n  let phone = \"\";\n  if (rawPhone) {\n    const normalized = normalizeNorwegianMobile(rawPhone);\n    if (!normalized) {\n      return NextResponse.json(\n        { error: \"Ugyldig mobilnummer. La feltet st\u00e5 tomt, eller bruk et norsk mobilnummer.\" },\n        { status: 400 }\n      );\n    }\n    phone = normalized;\n  }\n\n  const dates = generateWeeklyDates(date, weeks);\n  const durationSlots = durationMinutesToSlots(durationMinutes);\n  const occurrences = dates.map((d) => occurrenceRange(d, time, durationSlots));\n  if (occurrences.some((o) => !o)) {\n    return NextResponse.json({ error: \"Klokkeslettet finnes ikke i timeplanen.\" }, { status: 400 });\n  }\n  const validOccurrences = occurrences as Array<{ startTime: Date; endTime: Date }>;\n\n  // Hver dato i rekken kan ha sine EGNE \u00e5pningstider (ukedagens standard,\n  // eller en \"ferie/annerledesdag\"-unntak) \u2013 sl\u00e5 opp alt i \u00e9tt oppslag og\n  // sjekk hver forekomst mot sin egen dags effektive \u00e5pningstid, i stedet\n  // for \u00e9n global \u00e5pningstid for alle datoene. Samme m\u00f8nster som\n  // app/api/squash/bookings/route.ts.\n  const hoursContext = await getHoursContext();\n  const outOfHoursIndex = validOccurrences.findIndex(\n    (o, i) => !isWithinOpeningHours(o.startTime, o.endTime, effectiveHoursForDate(dates[i], hoursContext))\n  );\n  if (outOfHoursIndex !== -1) {\n    return NextResponse.json(\n      {\n        error:\n          weeks > 1\n            ? `${dates[outOfHoursIndex]} er stengt eller har andre \u00e5pningstider \u2013 juster klokkeslett eller antall uker.`\n            : \"Denne dagen er stengt, eller klokkeslettet passer ikke innenfor \u00e5pningstidene.\",\n      },\n      { status: 400 }\n    );\n  }\n\n  const pricing = await getPricingSettings();\n  const repo = await getRepository();\n  const result = await repo.createAdminBooking({\n    customerName: name,\n    customerPhone: phone,\n    totalAmountOre: priceForDuration(pricing, durationMinutes) * validOccurrences.length,\n    ranges: validOccurrences.map((o) => ({ startTime: o.startTime.toISOString(), endTime: o.endTime.toISOString() })),\n  });\n\n  if (!result.ok) {\n    return NextResponse.json(\n      {\n        error:\n          weeks > 1\n            ? \"\u00c9n eller flere av datoene i rekken er allerede opptatt. Juster tidspunkt eller antall uker.\"\n            : \"Den tiden er allerede opptatt. Velg et annet klokkeslett.\",\n        conflicts: result.conflicts,\n      },\n      { status: 409 }\n    );\n  }\n\n  return NextResponse.json({ ok: true, id: result.group.id });\n}\n",
    "manual-route-full-file",
    "weeks?: number",
) and ok

print()
if not ok:
    print("SOME STEPS WERE SKIPPED - see [SKIPPED] messages above.")
    print("Ingenting annet ble kjort (ingen typecheck).")
    sys.exit(1)

print("Endringene er lagt inn (eller var allerede gjort fra for).")
print()
print("Kjorer \"npm run typecheck\" for a sjekke at alt fortsatt kompilerer riktig ...")
print()
result = subprocess.run(["npm", "run", "typecheck"], cwd=ROOT)
print()
if result.returncode == 0:
    print("TYPECHECK OK - alt kompilerer. Endringene er ferdig lagt inn.")
else:
    print("TYPECHECK FEILET - se TypeScript-feilmeldingene over. Si fra til Claude, ikke deploy enda.")
    sys.exit(1)
