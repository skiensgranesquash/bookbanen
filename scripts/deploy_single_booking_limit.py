import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(".").resolve()
P_SLOTS = ROOT / "lib" / "slots.ts"
P_AVAILABILITY = ROOT / "app" / "api" / "squash" / "availability" / "route.ts"
P_BOOKINGS = ROOT / "app" / "api" / "squash" / "bookings" / "route.ts"
P_BC = ROOT / "app" / "BookingCalendar.tsx"
P_PAGE = ROOT / "app" / "page.tsx"
P_OHM = ROOT / "app" / "admin" / "opening-hours" / "OpeningHoursManager.tsx"
P_SINGLE_LIMIT = ROOT / "lib" / "settings" / "singleBookingLimit.ts"
P_SINGLE_LIMIT_ROUTE = ROOT / "app" / "api" / "admin" / "settings" / "single-booking-limit" / "route.ts"


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
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(new_text, encoding="utf-8")
    print(f"[OK] {label} (full file written)")
    return True


ok = True

ok = apply_regex(
    P_SLOTS,
    "/\\*\\*\\ Siste\\ dato\\ man\\ har\\ lov\\ til\\ .*?\\ booke\\ en\\ enkelttime,\\ som\\ \"YYYY\\-MM\\-DD\"\\.\\ \\*/\\\nexport\\ function\\ maxBookableDate\\(\\):\\ string\\ \\{\\\n\\ \\ return\\ zonedDateString\\(addDays\\(new\\ Date\\(\\),\\ MAX_DAYS_AHEAD\\),\\ TIME_ZONE\\);\\\n\\}\\\n\\\n/\\*\\*\\ Om\\ en\\ dato\\ er\\ innenfor\\ vinduet\\ man\\ har\\ lov\\ til\\ .*?\\ booke\\ en\\ enkelttime\\.\\ \\*/\\\nexport\\ function\\ isDateBookable\\(dateStr:\\ string\\):\\ boolean\\ \\{\\\n\\ \\ if\\ \\(!isValidBookingDateString\\(dateStr\\)\\)\\ return\\ false;\\\n\\ \\ return\\ dateStr\\ >=\\ todayInClubTimeZone\\(\\)\\ \\&\\&\\ dateStr\\ <=\\ maxBookableDate\\(\\);\\\n\\}",
    "/**\n * Siste dato man har lov til \u00e5 booke en enkelttime, som \"YYYY-MM-DD\".\n * `maxDaysAhead` er klubbens EGEN, admin-styrte grense for enkelttimer (se\n * lib/settings/singleBookingLimit.ts \u2013 \"Grense for enkelttimer\" i\n * adminpanelet) \u2013 IKKE lenger den tidligere hardkodede MAX_DAYS_AHEAD-\n * konstanten direkte. Parameteret har likevel MAX_DAYS_AHEAD som standard\n * (kun brukt der ingen innstilling er sl\u00e5tt opp enn\u00e5), slik at funksjonen\n * fortsatt er en rein, synkron funksjon som kan kalles direkte fra\n * klientkode (se app/BookingCalendar.tsx).\n */\nexport function maxBookableDate(maxDaysAhead: number = MAX_DAYS_AHEAD): string {\n  return zonedDateString(addDays(new Date(), maxDaysAhead), TIME_ZONE);\n}\n\n/**\n * Om en dato er innenfor vinduet man har lov til \u00e5 booke en enkelttime.\n * Se `maxBookableDate` over for hva `maxDaysAhead` betyr \u2013 admins egne\n * bookinger (se app/api/squash/availability/route.ts) bruker IKKE denne\n * grensen i det hele tatt lenger, siden den kun gjelder kundens\n * selvbetjente enkeltbooking.\n */\nexport function isDateBookable(dateStr: string, maxDaysAhead: number = MAX_DAYS_AHEAD): boolean {\n  if (!isValidBookingDateString(dateStr)) return false;\n  return dateStr >= todayInClubTimeZone() && dateStr <= maxBookableDate(maxDaysAhead);\n}",
    "slots-optional-maxdaysahead",
    "export function isDateBookable(dateStr: string, maxDaysAhead: number = MAX_DAYS_AHEAD): boolean {",
) and ok

ok = apply_regex(
    P_AVAILABILITY,
    "import\\ \\{\\ NextRequest,\\ NextResponse\\ \\}\\ from\\ \"next/server\";\\\nimport\\ \\{\\ getRepository\\ \\}\\ from\\ \"@/lib/db\";\\\nimport\\ \\{\\ expireStaleHolds\\ \\}\\ from\\ \"@/lib/holds\";\\\nimport\\ \\{\\ COURT_ID\\ \\}\\ from\\ \"@/lib/config\";\\\nimport\\ \\{\\ getEffectiveHoursForDate\\ \\}\\ from\\ \"@/lib/settings/openingHours\";\\\nimport\\ \\{\\ generateSlotsForDate,\\ isDateBookable,\\ isValidBookingDateString\\ \\}\\ from\\ \"@/lib/slots\";",
    "import { NextRequest, NextResponse } from \"next/server\";\nimport { getRepository } from \"@/lib/db\";\nimport { expireStaleHolds } from \"@/lib/holds\";\nimport { COURT_ID } from \"@/lib/config\";\nimport { SESSION_COOKIE_NAME, verifySessionCookieValue } from \"@/lib/auth/session\";\nimport { getEffectiveHoursForDate } from \"@/lib/settings/openingHours\";\nimport { getSingleBookingMaxDaysAhead } from \"@/lib/settings/singleBookingLimit\";\nimport { generateSlotsForDate, isDateBookable, isValidBookingDateString } from \"@/lib/slots\";",
    "availability-imports",
    "import { getSingleBookingMaxDaysAhead } from \"@/lib/settings/singleBookingLimit\";",
) and ok

ok = apply_regex(
    P_AVAILABILITY,
    "\\ \\ if\\ \\(!isDateBookable\\(dateStr\\)\\)\\ \\{\\\n\\ \\ \\ \\ return\\ NextResponse\\.json\\(\\{\\ date:\\ dateStr,\\ slots:\\ \\[\\],\\ closed:\\ true,\\ note:\\ null\\ \\}\\);\\\n\\ \\ \\}",
    "  // Admins EGEN innloggede sesjon er UNNTATT grensen for \"hvor mange dager\n  // frem i tid\" under \u2013 den gjelder kun kundens selvbetjente enkeltbooking\n  // p\u00e5 bookingsiden, ikke adminpanelets manuelle booking (som henter ledige\n  // tider fra nettopp dette endepunktet, se app/admin/BookingsInsights.tsx).\n  // Uten dette unntaket ble admin feilaktig m\u00f8tt med \"stengt denne dagen\" p\u00e5\n  // alle datoer forbi grensen, selv n\u00e5r banen i realiteten var \u00e5pen.\n  const adminSession = await verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);\n\n  if (!adminSession) {\n    const maxDaysAhead = await getSingleBookingMaxDaysAhead();\n    if (!isDateBookable(dateStr, maxDaysAhead)) {\n      return NextResponse.json({ date: dateStr, slots: [], closed: true, note: null });\n    }\n  }",
    "availability-admin-bypass-gate",
    "const adminSession = await verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);",
) and ok

ok = apply_regex(
    P_BOOKINGS,
    "import\\ \\{\\ effectiveHoursForDate,\\ getHoursContext\\ \\}\\ from\\ \"@/lib/settings/openingHours\";\\\nimport\\ \\{\\ getPricingSettings,\\ priceForDuration\\ \\}\\ from\\ \"@/lib/settings/pricing\";\\\nimport\\ \\{\\ getRecurringCutoffDate,\\ getRecurringMaxWeeks\\ \\}\\ from\\ \"@/lib/settings/recurringLimit\";",
    "import { effectiveHoursForDate, getHoursContext } from \"@/lib/settings/openingHours\";\nimport { getPricingSettings, priceForDuration } from \"@/lib/settings/pricing\";\nimport { getRecurringCutoffDate, getRecurringMaxWeeks } from \"@/lib/settings/recurringLimit\";\nimport { getSingleBookingMaxDaysAhead } from \"@/lib/settings/singleBookingLimit\";",
    "bookings-imports",
    "import { getSingleBookingMaxDaysAhead } from \"@/lib/settings/singleBookingLimit\";",
) and ok

ok = apply_regex(
    P_BOOKINGS,
    "\\ \\ if\\ \\(mode\\ ===\\ \"single\"\\ \\&\\&\\ !isDateBookable\\(date\\)\\)\\ \\{\\\n\\ \\ \\ \\ return\\ NextResponse\\.json\\(\\{\\ error:\\ \"Datoen\\ er\\ ikke\\ bookbar\\.\"\\ \\},\\ \\{\\ status:\\ 400\\ \\}\\);\\\n\\ \\ \\}",
    "  if (mode === \"single\") {\n    const maxDaysAhead = await getSingleBookingMaxDaysAhead();\n    if (!isDateBookable(date, maxDaysAhead)) {\n      return NextResponse.json({ error: \"Datoen er ikke bookbar.\" }, { status: 400 });\n    }\n  }",
    "bookings-single-mode-check",
    "const maxDaysAhead = await getSingleBookingMaxDaysAhead();",
) and ok

ok = apply_regex(
    P_BC,
    "interface\\ BookingCalendarProps\\ \\{\\\n\\ \\ /\\*\\*\\ Siste\\ dato\\ en\\ gjentakende\\ booking\\ har\\ lov\\ til\\ .*?\\ dekke\\ \\(satt\\ av\\ klubben\\ i\\ adminpanelet\\),\\ eller\\ null\\ for\\ ingen\\ egen\\ grense\\ .*?\\ se\\ lib/settings/recurringLimit\\.ts\\.\\ \\*/\\\n\\ \\ recurringCutoffDate:\\ string\\ \\|\\ null;\\\n\\ \\ /\\*\\*\\ Maks\\ antall\\ uker\\ i\\ en\\ enkelt\\ serie\\ \\(satt\\ av\\ klubben\\ i\\ adminpanelet\\),\\ eller\\ null\\ for\\ ingen\\ egen\\ grense\\ \\(da\\ gjelder\\ kun\\ MAX_RECURRING_WEEKS\\)\\ .*?\\ se\\ lib/settings/recurringLimit\\.ts\\.\\ Denne\\ og\\ recurringCutoffDate\\ er\\ to\\ UAVHENGIGE\\ grenser\\ som\\ begge\\ gjelder\\ samtidig\\ \\(den\\ strengeste\\ vinner\\)\\.\\ \\*/\\\n\\ \\ recurringMaxWeeks:\\ number\\ \\|\\ null;\\\n\\ \\ /\\*\\*\\ Dagens\\ priser\\ \\(i\\ .*?re\\),\\ satt\\ av\\ klubben\\ i\\ adminpanelet\\ .*?\\ se\\ lib/settings/pricing\\.ts\\.\\ De\\ to\\ er\\ HELT\\ uavhengige\\ av\\ hverandre\\ \\(1\\ time\\ er\\ ikke\\ n.*?dvendigvis\\ dobbelt\\ s.*?\\ dyrt\\ som\\ 30\\ min\\)\\.\\ \\*/\\\n\\ \\ price30MinOre:\\ number;\\\n\\ \\ price60MinOre:\\ number;\\\n\\}\\\n\\\nexport\\ default\\ function\\ BookingCalendar\\(\\{\\\n\\ \\ recurringCutoffDate,\\\n\\ \\ recurringMaxWeeks,\\\n\\ \\ price30MinOre,\\\n\\ \\ price60MinOre,\\\n\\}:\\ BookingCalendarProps\\)\\ \\{\\\n\\ \\ const\\ today\\ =\\ useMemo\\(\\(\\)\\ =>\\ todayInClubTimeZone\\(\\),\\ \\[\\]\\);\\\n\\ \\ const\\ maxDate\\ =\\ useMemo\\(\\(\\)\\ =>\\ maxBookableDate\\(\\),\\ \\[\\]\\);",
    "interface BookingCalendarProps {\n  /** Siste dato en gjentakende booking har lov til \u00e5 dekke (satt av klubben i adminpanelet), eller null for ingen egen grense \u2013 se lib/settings/recurringLimit.ts. */\n  recurringCutoffDate: string | null;\n  /** Maks antall uker i en enkelt serie (satt av klubben i adminpanelet), eller null for ingen egen grense (da gjelder kun MAX_RECURRING_WEEKS) \u2013 se lib/settings/recurringLimit.ts. Denne og recurringCutoffDate er to UAVHENGIGE grenser som begge gjelder samtidig (den strengeste vinner). */\n  recurringMaxWeeks: number | null;\n  /** Hvor mange dager frem i tid en enkelttime har lov til \u00e5 bookes (satt av klubben i adminpanelet) \u2013 se lib/settings/singleBookingLimit.ts. Gjelder KUN kundens egen, selvbetjente enkeltbooking her \u2013 admins egen manuelle booking i adminpanelet er unntatt denne grensen. */\n  maxSingleBookingDaysAhead: number;\n  /** Dagens priser (i \u00f8re), satt av klubben i adminpanelet \u2013 se lib/settings/pricing.ts. De to er HELT uavhengige av hverandre (1 time er ikke n\u00f8dvendigvis dobbelt s\u00e5 dyrt som 30 min). */\n  price30MinOre: number;\n  price60MinOre: number;\n}\n\nexport default function BookingCalendar({\n  recurringCutoffDate,\n  recurringMaxWeeks,\n  maxSingleBookingDaysAhead,\n  price30MinOre,\n  price60MinOre,\n}: BookingCalendarProps) {\n  const today = useMemo(() => todayInClubTimeZone(), []);\n  const maxDate = useMemo(() => maxBookableDate(maxSingleBookingDaysAhead), [maxSingleBookingDaysAhead]);",
    "bc-prop-and-maxdate",
    "maxSingleBookingDaysAhead: number;",
) and ok

ok = apply_regex(
    P_PAGE,
    "import\\ \\{\\ getBranding\\ \\}\\ from\\ \"@/lib/settings/branding\";\\\nimport\\ \\{\\ getPricingSettings\\ \\}\\ from\\ \"@/lib/settings/pricing\";\\\nimport\\ \\{\\ getRecurringCutoffDate,\\ getRecurringMaxWeeks\\ \\}\\ from\\ \"@/lib/settings/recurringLimit\";",
    "import { getBranding } from \"@/lib/settings/branding\";\nimport { getPricingSettings } from \"@/lib/settings/pricing\";\nimport { getRecurringCutoffDate, getRecurringMaxWeeks } from \"@/lib/settings/recurringLimit\";\nimport { getSingleBookingMaxDaysAhead } from \"@/lib/settings/singleBookingLimit\";",
    "page-imports",
    "import { getSingleBookingMaxDaysAhead } from \"@/lib/settings/singleBookingLimit\";",
) and ok

ok = apply_regex(
    P_PAGE,
    "\\ \\ const\\ \\[branding,\\ recurringCutoffDate,\\ recurringMaxWeeks,\\ pricing\\]\\ =\\ await\\ Promise\\.all\\(\\[\\\n\\ \\ \\ \\ getBranding\\(\\),\\\n\\ \\ \\ \\ getRecurringCutoffDate\\(\\),\\\n\\ \\ \\ \\ getRecurringMaxWeeks\\(\\),\\\n\\ \\ \\ \\ getPricingSettings\\(\\),\\\n\\ \\ \\]\\);",
    "  const [branding, recurringCutoffDate, recurringMaxWeeks, maxSingleBookingDaysAhead, pricing] = await Promise.all([\n    getBranding(),\n    getRecurringCutoffDate(),\n    getRecurringMaxWeeks(),\n    getSingleBookingMaxDaysAhead(),\n    getPricingSettings(),\n  ]);",
    "page-fetch-array",
    "getSingleBookingMaxDaysAhead(),",
) and ok

ok = apply_regex(
    P_PAGE,
    "\\ \\ \\ \\ \\ \\ <BookingCalendar\\\n\\ \\ \\ \\ \\ \\ \\ \\ recurringCutoffDate=\\{recurringCutoffDate\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ recurringMaxWeeks=\\{recurringMaxWeeks\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ price30MinOre=\\{pricing\\.price30MinOre\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ price60MinOre=\\{pricing\\.price60MinOre\\}\\\n\\ \\ \\ \\ \\ \\ />",
    "      <BookingCalendar\n        recurringCutoffDate={recurringCutoffDate}\n        recurringMaxWeeks={recurringMaxWeeks}\n        maxSingleBookingDaysAhead={maxSingleBookingDaysAhead}\n        price30MinOre={pricing.price30MinOre}\n        price60MinOre={pricing.price60MinOre}\n      />",
    "page-jsx-prop",
    "maxSingleBookingDaysAhead={maxSingleBookingDaysAhead}",
) and ok

ok = apply_regex(
    P_OHM,
    "import\\ \\{\\ MAX_RECURRING_WEEKS\\ \\}\\ from\\ \"@/lib/config\";",
    "import { MAX_DAYS_AHEAD, MAX_RECURRING_WEEKS } from \"@/lib/config\";",
    "ohm-import",
    "import { MAX_DAYS_AHEAD, MAX_RECURRING_WEEKS } from \"@/lib/config\";",
) and ok

ok = apply_regex(
    P_OHM,
    "\\ \\ const\\ \\[maxWeeks,\\ setMaxWeeks\\]\\ =\\ useState\\(\"\"\\);\\\n\\ \\ const\\ \\[savingMaxWeeks,\\ setSavingMaxWeeks\\]\\ =\\ useState\\(false\\);\\\n\\ \\ const\\ \\[maxWeeksMessage,\\ setMaxWeeksMessage\\]\\ =\\ useState<\\{\\ ok:\\ boolean;\\ text:\\ string\\ \\}\\ \\|\\ null>\\(null\\);",
    "  const [maxWeeks, setMaxWeeks] = useState(\"\");\n  const [savingMaxWeeks, setSavingMaxWeeks] = useState(false);\n  const [maxWeeksMessage, setMaxWeeksMessage] = useState<{ ok: boolean; text: string } | null>(null);\n\n  // Grense for ENKELTTIMER \u2013 hvor mange dager frem i tid KUNDEN selv kan\n  // booke en enkelttime p\u00e5 bookingsiden (se\n  // lib/settings/singleBookingLimit.ts). Helt uavhengig av grensene for\n  // gjentakende bookinger over \u2013 admins egen manuelle booking i\n  // adminpanelet er IKKE p\u00e5virket av denne grensen i det hele tatt (se\n  // app/api/squash/availability/route.ts).\n  const [singleMaxDays, setSingleMaxDays] = useState(\"\");\n  const [singleMaxDaysLoading, setSingleMaxDaysLoading] = useState(true);\n  const [savingSingleMaxDays, setSavingSingleMaxDays] = useState(false);\n  const [singleMaxDaysMessage, setSingleMaxDaysMessage] = useState<{ ok: boolean; text: string } | null>(null);",
    "ohm-state",
    "const [singleMaxDays, setSingleMaxDays] = useState(\"\");",
) and ok

ok = apply_regex(
    P_OHM,
    "\\ \\ useEffect\\(\\(\\)\\ =>\\ \\{\\\n\\ \\ \\ \\ fetch\\(\"/api/admin/settings/recurring\\-limit\",\\ \\{\\ cache:\\ \"no\\-store\"\\ \\}\\)\\\n\\ \\ \\ \\ \\ \\ \\.then\\(\\(res\\)\\ =>\\ \\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ if\\ \\(!res\\.ok\\)\\ throw\\ new\\ Error\\(\"Kunne\\ ikke\\ hente\\ grensen\\.\"\\);\\\n\\ \\ \\ \\ \\ \\ \\ \\ return\\ res\\.json\\(\\)\\ as\\ Promise<\\{\\ cutoffDate:\\ string\\ \\|\\ null;\\ maxWeeks:\\ number\\ \\|\\ null\\ \\}>;\\\n\\ \\ \\ \\ \\ \\ \\}\\)\\\n\\ \\ \\ \\ \\ \\ \\.then\\(\\(data\\)\\ =>\\ \\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ setCutoffDate\\(data\\.cutoffDate\\ \\?\\?\\ \"\"\\);\\\n\\ \\ \\ \\ \\ \\ \\ \\ setMaxWeeks\\(data\\.maxWeeks\\ !=\\ null\\ \\?\\ String\\(data\\.maxWeeks\\)\\ :\\ \"\"\\);\\\n\\ \\ \\ \\ \\ \\ \\}\\)\\\n\\ \\ \\ \\ \\ \\ \\.catch\\(\\(\\)\\ =>\\ \\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ //\\ Ikke\\ kritisk\\ nok\\ til\\ .*?\\ blokkere\\ resten\\ av\\ siden\\ .*?\\ feltene\\ starter\\ bare\\ tomme\\.\\\n\\ \\ \\ \\ \\ \\ \\}\\)\\\n\\ \\ \\ \\ \\ \\ \\.finally\\(\\(\\)\\ =>\\ setCutoffLoading\\(false\\)\\);\\\n\\ \\ \\},\\ \\[\\]\\);",
    "  useEffect(() => {\n    fetch(\"/api/admin/settings/recurring-limit\", { cache: \"no-store\" })\n      .then((res) => {\n        if (!res.ok) throw new Error(\"Kunne ikke hente grensen.\");\n        return res.json() as Promise<{ cutoffDate: string | null; maxWeeks: number | null }>;\n      })\n      .then((data) => {\n        setCutoffDate(data.cutoffDate ?? \"\");\n        setMaxWeeks(data.maxWeeks != null ? String(data.maxWeeks) : \"\");\n      })\n      .catch(() => {\n        // Ikke kritisk nok til \u00e5 blokkere resten av siden \u2013 feltene starter bare tomme.\n      })\n      .finally(() => setCutoffLoading(false));\n  }, []);\n\n  useEffect(() => {\n    fetch(\"/api/admin/settings/single-booking-limit\", { cache: \"no-store\" })\n      .then((res) => {\n        if (!res.ok) throw new Error(\"Kunne ikke hente grensen.\");\n        return res.json() as Promise<{ maxDaysAhead: number }>;\n      })\n      .then((data) => {\n        setSingleMaxDays(String(data.maxDaysAhead));\n      })\n      .catch(() => {\n        // Ikke kritisk nok til \u00e5 blokkere resten av siden \u2013 feltet starter bare tomt.\n      })\n      .finally(() => setSingleMaxDaysLoading(false));\n  }, []);",
    "ohm-effect",
    "\"/api/admin/settings/single-booking-limit\"",
) and ok

ok = apply_regex(
    P_OHM,
    "\\ \\ async\\ function\\ handleClearMaxWeeks\\(\\)\\ \\{\\\n\\ \\ \\ \\ setSavingMaxWeeks\\(true\\);\\\n\\ \\ \\ \\ setMaxWeeksMessage\\(null\\);\\\n\\\n\\ \\ \\ \\ try\\ \\{\\\n\\ \\ \\ \\ \\ \\ const\\ res\\ =\\ await\\ fetch\\(\"/api/admin/settings/recurring\\-limit\",\\ \\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ method:\\ \"POST\",\\\n\\ \\ \\ \\ \\ \\ \\ \\ headers:\\ \\{\\ \"Content\\-Type\":\\ \"application/json\"\\ \\},\\\n\\ \\ \\ \\ \\ \\ \\ \\ body:\\ JSON\\.stringify\\(\\{\\ maxWeeks:\\ null\\ \\}\\),\\\n\\ \\ \\ \\ \\ \\ \\}\\);\\\n\\ \\ \\ \\ \\ \\ const\\ data\\ =\\ \\(await\\ res\\.json\\(\\)\\)\\ as\\ \\{\\ error\\?:\\ string\\ \\};\\\n\\ \\ \\ \\ \\ \\ if\\ \\(!res\\.ok\\)\\ \\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ setMaxWeeksMessage\\(\\{\\ ok:\\ false,\\ text:\\ data\\.error\\ \\?\\?\\ \"Kunne\\ ikke\\ tilbakestille\\.\"\\ \\}\\);\\\n\\ \\ \\ \\ \\ \\ \\ \\ return;\\\n\\ \\ \\ \\ \\ \\ \\}\\\n\\ \\ \\ \\ \\ \\ setMaxWeeks\\(\"\"\\);\\\n\\ \\ \\ \\ \\ \\ setMaxWeeksMessage\\(\\{\\ ok:\\ true,\\ text:\\ `Tilbakestilt\\ til\\ \\$\\{MAX_RECURRING_WEEKS\\}\\ uker\\.`\\ \\}\\);\\\n\\ \\ \\ \\ \\}\\ catch\\ \\{\\\n\\ \\ \\ \\ \\ \\ setMaxWeeksMessage\\(\\{\\ ok:\\ false,\\ text:\\ \"Kunne\\ ikke\\ tilbakestille\\ akkurat\\ n.*?\\.\"\\ \\}\\);\\\n\\ \\ \\ \\ \\}\\ finally\\ \\{\\\n\\ \\ \\ \\ \\ \\ setSavingMaxWeeks\\(false\\);\\\n\\ \\ \\ \\ \\}\\\n\\ \\ \\}",
    "  async function handleClearMaxWeeks() {\n    setSavingMaxWeeks(true);\n    setMaxWeeksMessage(null);\n\n    try {\n      const res = await fetch(\"/api/admin/settings/recurring-limit\", {\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" },\n        body: JSON.stringify({ maxWeeks: null }),\n      });\n      const data = (await res.json()) as { error?: string };\n      if (!res.ok) {\n        setMaxWeeksMessage({ ok: false, text: data.error ?? \"Kunne ikke tilbakestille.\" });\n        return;\n      }\n      setMaxWeeks(\"\");\n      setMaxWeeksMessage({ ok: true, text: `Tilbakestilt til ${MAX_RECURRING_WEEKS} uker.` });\n    } catch {\n      setMaxWeeksMessage({ ok: false, text: \"Kunne ikke tilbakestille akkurat n\u00e5.\" });\n    } finally {\n      setSavingMaxWeeks(false);\n    }\n  }\n\n  async function handleSaveSingleMaxDays(e: FormEvent) {\n    e.preventDefault();\n    setSavingSingleMaxDays(true);\n    setSingleMaxDaysMessage(null);\n\n    try {\n      const res = await fetch(\"/api/admin/settings/single-booking-limit\", {\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" },\n        body: JSON.stringify({ maxDaysAhead: singleMaxDays ? Number(singleMaxDays) : null }),\n      });\n      const data = (await res.json()) as { error?: string; maxDaysAhead?: number };\n      if (!res.ok) {\n        setSingleMaxDaysMessage({ ok: false, text: data.error ?? \"Kunne ikke lagre.\" });\n        return;\n      }\n      if (typeof data.maxDaysAhead === \"number\") setSingleMaxDays(String(data.maxDaysAhead));\n      setSingleMaxDaysMessage({ ok: true, text: \"Grense lagret.\" });\n    } catch {\n      setSingleMaxDaysMessage({ ok: false, text: \"Kunne ikke lagre akkurat n\u00e5.\" });\n    } finally {\n      setSavingSingleMaxDays(false);\n    }\n  }\n\n  async function handleResetSingleMaxDays() {\n    setSavingSingleMaxDays(true);\n    setSingleMaxDaysMessage(null);\n\n    try {\n      const res = await fetch(\"/api/admin/settings/single-booking-limit\", {\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" },\n        body: JSON.stringify({ maxDaysAhead: null }),\n      });\n      const data = (await res.json()) as { error?: string; maxDaysAhead?: number };\n      if (!res.ok) {\n        setSingleMaxDaysMessage({ ok: false, text: data.error ?? \"Kunne ikke tilbakestille.\" });\n        return;\n      }\n      setSingleMaxDays(typeof data.maxDaysAhead === \"number\" ? String(data.maxDaysAhead) : \"\");\n      setSingleMaxDaysMessage({ ok: true, text: `Tilbakestilt til ${MAX_DAYS_AHEAD} dager.` });\n    } catch {\n      setSingleMaxDaysMessage({ ok: false, text: \"Kunne ikke tilbakestille akkurat n\u00e5.\" });\n    } finally {\n      setSavingSingleMaxDays(false);\n    }\n  }",
    "ohm-handlers",
    "async function handleSaveSingleMaxDays(e: FormEvent) {",
) and ok

ok = apply_regex(
    P_OHM,
    "\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ Tilbakestill\\ til\\ \\{MAX_RECURRING_WEEKS\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ </button>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ </div>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ </form>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\)\\}\\\n\\ \\ \\ \\ \\ \\ </div>\\\n\\ \\ \\ \\ \\ \\ </div>\\\n\\\n\\ \\ \\ \\ \\ \\ \\{loading\\ \\&\\&\\ <p>Laster\\ .*?</p>\\}",
    "                Tilbakestill til {MAX_RECURRING_WEEKS}\n              </button>\n            </div>\n          </form>\n        )}\n      </div>\n\n      <div className={styles.card}>\n        <h2 style={{ marginTop: 0, fontSize: \"1.1rem\" }}>Grense for enkelttimer</h2>\n        <p className={styles.bookingMeta}>\n          Hvor mange dager frem i tid KUNDEN selv kan booke en enkelttime p\u00e5 bookingsiden. Helt uavhengig av grensene\n          for gjentakende bookinger over \u2013 p\u00e5virker IKKE admins egen manuelle booking her i adminpanelet, som alltid\n          kan booke like langt frem i tid som \u00e5pningstidene og kalenderen tillater.\n        </p>\n        {singleMaxDaysLoading ? (\n          <p>Laster \u2026</p>\n        ) : (\n          <form onSubmit={handleSaveSingleMaxDays} className={styles.form}>\n            <div className={styles.formRow}>\n              <label htmlFor=\"single-max-days\">Antall dager frem i tid</label>\n              <input\n                id=\"single-max-days\"\n                type=\"number\"\n                min={1}\n                value={singleMaxDays}\n                onChange={(e) => setSingleMaxDays(e.target.value)}\n              />\n            </div>\n\n            {singleMaxDaysMessage && (\n              <p className={singleMaxDaysMessage.ok ? styles.success : styles.error}>{singleMaxDaysMessage.text}</p>\n            )}\n\n            <div style={{ display: \"flex\", gap: \"8px\", flexWrap: \"wrap\" }}>\n              <button type=\"submit\" className={styles.submitButton} disabled={savingSingleMaxDays || !singleMaxDays}>\n                {savingSingleMaxDays ? \"Lagrer \u2026\" : \"Lagre\"}\n              </button>\n              <button\n                type=\"button\"\n                className={styles.dangerButton}\n                disabled={savingSingleMaxDays || !singleMaxDays}\n                onClick={handleResetSingleMaxDays}\n              >\n                Tilbakestill til {MAX_DAYS_AHEAD}\n              </button>\n            </div>\n          </form>\n        )}\n      </div>\n      </div>\n\n      {loading && <p>Laster \u2026</p>}",
    "ohm-jsx-card",
    "Grense for enkelttimer",
) and ok

ok = write_full_file(
    P_SINGLE_LIMIT,
    "import \"server-only\";\nimport { getRepository } from \"@/lib/db\";\nimport { MAX_DAYS_AHEAD } from \"@/lib/config\";\n\n/**\n * Hvor mange dager frem i tid en kunde har lov til \u00e5 booke en enkelttime \u2013\n * satt av klubben i adminpanelet (se\n * app/admin/opening-hours/OpeningHoursManager.tsx, kortet \"Grense for\n * enkelttimer\"). Lagret i den samme generiske n\u00f8kkel/verdi-\n * innstillingstabellen som resten av innstillingene (se\n * lib/settings/recurringLimit.ts for samme m\u00f8nster).\n *\n * Dette var tidligere en HARDKODET konstant (MAX_DAYS_AHEAD i\n * lib/config.ts) som gjaldt for ALLE kall til GET /api/squash/availability\n * \u2013 inkludert n\u00e5r ADMIN selv henter ledige tider til sin egen manuelle\n * booking (se app/admin/BookingsInsights.tsx). Det gjorde at admin heller\n * ikke fikk booke lenger frem enn akkurat det kundene selv fikk, og dukket\n * opp som \"stengt denne dagen\" p\u00e5 alle datoer forbi grensen \u2013 selv om\n * banen i realiteten var \u00e5pen. Admin er n\u00e5 UNNTATT denne grensen helt (se\n * app/api/squash/availability/route.ts, som gjenkjenner admins egen\n * innloggede sesjon og hopper over sjekken) \u2013 denne innstillingen gjelder\n * dermed KUN kundens egen, selvbetjente enkeltbooking p\u00e5 bookingsiden.\n *\n * `null`/ikke satt betyr \"bruk MAX_DAYS_AHEAD\" (dagens standardverdi,\n * 14 dager) \u2013 akkurat som f\u00f8r denne innstillingen fantes.\n */\nconst KEY = \"singleBookingMaxDaysAhead\";\n\n/** Mest en enkelttime kan lov til \u00e5 bookes \u2013 en romslig, men ikke ubegrenset, teknisk grense (~10 \u00e5r) mot feilinntastinger. */\nconst MAX_ALLOWED_DAYS_AHEAD = 3650;\n\nexport async function getSingleBookingMaxDaysAhead(): Promise<number> {\n  const repo = await getRepository();\n  const raw = await repo.getSetting(KEY);\n  if (!raw) return MAX_DAYS_AHEAD;\n  const n = Number(raw);\n  return Number.isInteger(n) && n >= 1 && n <= MAX_ALLOWED_DAYS_AHEAD ? n : MAX_DAYS_AHEAD;\n}\n\n/**\n * `days: null` fjerner innstillingen igjen (tilbake til MAX_DAYS_AHEAD).\n * Kaster med en norsk feilmelding ved et ugyldig antall.\n */\nexport async function saveSingleBookingMaxDaysAhead(days: number | null): Promise<number> {\n  const repo = await getRepository();\n\n  if (days === null) {\n    await repo.setSetting(KEY, \"\");\n    return MAX_DAYS_AHEAD;\n  }\n\n  if (!Number.isInteger(days) || days < 1 || days > MAX_ALLOWED_DAYS_AHEAD) {\n    throw new Error(`Ugyldig antall dager (m\u00e5 v\u00e6re et helt tall mellom 1 og ${MAX_ALLOWED_DAYS_AHEAD}).`);\n  }\n\n  await repo.setSetting(KEY, String(days));\n  return days;\n}\n",
    "single-booking-limit-settings-file",
    "singleBookingMaxDaysAhead",
) and ok

ok = write_full_file(
    P_SINGLE_LIMIT_ROUTE,
    "import { NextRequest, NextResponse } from \"next/server\";\nimport { getSingleBookingMaxDaysAhead, saveSingleBookingMaxDaysAhead } from \"@/lib/settings/singleBookingLimit\";\n\nexport const dynamic = \"force-dynamic\";\n\n/**\n * GET  /api/admin/settings/single-booking-limit - hent hvor mange dager\n *      frem i tid en enkelttime har lov til \u00e5 bookes (kundens egen,\n *      selvbetjente booking p\u00e5 bookingsiden - se\n *      lib/settings/singleBookingLimit.ts).\n * POST /api/admin/settings/single-booking-limit - sett (eller fjern, med\n *      `null`, som gir tilbake standardverdien MAX_DAYS_AHEAD) grensen.\n *\n * Beskyttet av middleware.ts som resten av /api/admin/** - krever gyldig\n * admin-sesjon.\n */\nexport async function GET() {\n  try {\n    const maxDaysAhead = await getSingleBookingMaxDaysAhead();\n    return NextResponse.json({ maxDaysAhead });\n  } catch (err) {\n    return NextResponse.json(\n      { error: err instanceof Error ? err.message : \"Kunne ikke hente grensen.\" },\n      { status: 500 }\n    );\n  }\n}\n\ninterface SaveBody {\n  maxDaysAhead?: number | null;\n}\n\nexport async function POST(request: NextRequest) {\n  let body: SaveBody;\n  try {\n    body = (await request.json()) as SaveBody;\n  } catch {\n    return NextResponse.json({ error: \"Ugyldig foresp\u00f8rsel.\" }, { status: 400 });\n  }\n\n  try {\n    const maxDaysAhead = await saveSingleBookingMaxDaysAhead(body.maxDaysAhead ?? null);\n    return NextResponse.json({ ok: true, maxDaysAhead });\n  } catch (err) {\n    return NextResponse.json({ error: err instanceof Error ? err.message : \"Kunne ikke lagre.\" }, { status: 400 });\n  }\n}\n",
    "single-booking-limit-api-route",
    "getSingleBookingMaxDaysAhead",
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
