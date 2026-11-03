import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(".").resolve()
P_SLOTS = ROOT / "lib" / "slots.ts"
P_SINGLE_LIMIT = ROOT / "lib" / "settings" / "singleBookingLimit.ts"
P_AVAILABILITY = ROOT / "app" / "api" / "squash" / "availability" / "route.ts"
P_BOOKINGS = ROOT / "app" / "api" / "squash" / "bookings" / "route.ts"
P_BC = ROOT / "app" / "BookingCalendar.tsx"
P_PAGE = ROOT / "app" / "page.tsx"
P_OHM = ROOT / "app" / "admin" / "opening-hours" / "OpeningHoursManager.tsx"


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
    "/\\*\\*\\\n\\ \\*\\ Om\\ en\\ dato\\ er\\ innenfor\\ vinduet\\ man\\ har\\ lov\\ til\\ .*?\\ booke\\ en\\ enkelttime\\.\\\n\\ \\*\\ Se\\ `maxBookableDate`\\ over\\ for\\ hva\\ `maxDaysAhead`\\ betyr\\ .*?\\ admins\\ egne\\\n\\ \\*\\ bookinger\\ \\(se\\ app/api/squash/availability/route\\.ts\\)\\ bruker\\ IKKE\\ denne\\\n\\ \\*\\ grensen\\ i\\ det\\ hele\\ tatt\\ lenger,\\ siden\\ den\\ kun\\ gjelder\\ kundens\\\n\\ \\*\\ selvbetjente\\ enkeltbooking\\.\\\n\\ \\*/\\\nexport\\ function\\ isDateBookable\\(dateStr:\\ string,\\ maxDaysAhead:\\ number\\ =\\ MAX_DAYS_AHEAD\\):\\ boolean\\ \\{\\\n\\ \\ if\\ \\(!isValidBookingDateString\\(dateStr\\)\\)\\ return\\ false;\\\n\\ \\ return\\ dateStr\\ >=\\ todayInClubTimeZone\\(\\)\\ \\&\\&\\ dateStr\\ <=\\ maxBookableDate\\(maxDaysAhead\\);\\\n\\}",
    "/**\n * Om en dato er innenfor vinduet man har lov til \u00e5 booke en enkelttime \u2013\n * `maxDate` er den FAKTISKE, allerede utregnede siste bookbare datoen (se\n * lib/settings/singleBookingLimit.ts sin getEffectiveSingleBookingMaxDate),\n * IKKE et antall dager. `null` (standard) betyr ingen \u00f8vre grense i det\n * hele tatt. En \"hovedadministrator\" (rolle \"full\", se\n * app/api/squash/availability/route.ts) er UNNTATT denne grensen helt n\u00e5r\n * hen selv booker \u2013 den gjelder kun kundens selvbetjente enkeltbooking (og\n * en begrenset \"bookings_only\"-administrator).\n */\nexport function isDateBookable(dateStr: string, maxDate: string | null = null): boolean {\n  if (!isValidBookingDateString(dateStr)) return false;\n  if (dateStr < todayInClubTimeZone()) return false;\n  return maxDate === null || dateStr <= maxDate;\n}",
    "slots-isdatebookable-maxdate",
    "return maxDate === null || dateStr <= maxDate;",
) and ok

ok = apply_regex(
    P_AVAILABILITY,
    "import\\ \\{\\ SESSION_COOKIE_NAME,\\ verifySessionCookieValue\\ \\}\\ from\\ \"@/lib/auth/session\";\\\nimport\\ \\{\\ getEffectiveHoursForDate\\ \\}\\ from\\ \"@/lib/settings/openingHours\";\\\nimport\\ \\{\\ getSingleBookingMaxDaysAhead\\ \\}\\ from\\ \"@/lib/settings/singleBookingLimit\";\\\nimport\\ \\{\\ generateSlotsForDate,\\ isDateBookable,\\ isValidBookingDateString\\ \\}\\ from\\ \"@/lib/slots\";",
    "import { SESSION_COOKIE_NAME, verifySessionCookieValue } from \"@/lib/auth/session\";\nimport { getEffectiveHoursForDate } from \"@/lib/settings/openingHours\";\nimport { getEffectiveSingleBookingMaxDate } from \"@/lib/settings/singleBookingLimit\";\nimport { generateSlotsForDate, isValidBookingDateString, todayInClubTimeZone } from \"@/lib/slots\";",
    "availability-imports-v2",
    "import { getEffectiveSingleBookingMaxDate } from \"@/lib/settings/singleBookingLimit\";",
) and ok

ok = apply_regex(
    P_AVAILABILITY,
    "\\ \\ //\\ Admins\\ EGEN\\ innloggede\\ sesjon\\ er\\ UNNTATT\\ grensen\\ for\\ \"hvor\\ mange\\ dager\\\n\\ \\ //\\ frem\\ i\\ tid\"\\ under\\ .*?\\ den\\ gjelder\\ kun\\ kundens\\ selvbetjente\\ enkeltbooking\\\n\\ \\ //\\ p.*?\\ bookingsiden,\\ ikke\\ adminpanelets\\ manuelle\\ booking\\ \\(som\\ henter\\ ledige\\\n\\ \\ //\\ tider\\ fra\\ nettopp\\ dette\\ endepunktet,\\ se\\ app/admin/BookingsInsights\\.tsx\\)\\.\\\n\\ \\ //\\ Uten\\ dette\\ unntaket\\ ble\\ admin\\ feilaktig\\ m.*?tt\\ med\\ \"stengt\\ denne\\ dagen\"\\ p.*?\\\n\\ \\ //\\ alle\\ datoer\\ forbi\\ grensen,\\ selv\\ n.*?r\\ banen\\ i\\ realiteten\\ var\\ .*?pen\\.\\\n\\ \\ const\\ adminSession\\ =\\ await\\ verifySessionCookieValue\\(request\\.cookies\\.get\\(SESSION_COOKIE_NAME\\)\\?\\.value\\);\\\n\\\n\\ \\ if\\ \\(!adminSession\\)\\ \\{\\\n\\ \\ \\ \\ const\\ maxDaysAhead\\ =\\ await\\ getSingleBookingMaxDaysAhead\\(\\);\\\n\\ \\ \\ \\ if\\ \\(!isDateBookable\\(dateStr,\\ maxDaysAhead\\)\\)\\ \\{\\\n\\ \\ \\ \\ \\ \\ return\\ NextResponse\\.json\\(\\{\\ date:\\ dateStr,\\ slots:\\ \\[\\],\\ closed:\\ true,\\ note:\\ null\\ \\}\\);\\\n\\ \\ \\ \\ \\}\\\n\\ \\ \\}",
    "  // En \"hovedadministrator\" (rolle \"full\", se AdminRole i lib/db/types.ts)\n  // sin EGEN innloggede sesjon er UNNTATT grensen under helt \u2013 den gjelder\n  // kun kundens selvbetjente enkeltbooking p\u00e5 bookingsiden (og en begrenset\n  // \"bookings_only\"-administrator), ikke en hovedadministrators egen\n  // manuelle booking i adminpanelet (som henter ledige tider fra nettopp\n  // dette endepunktet, se app/admin/BookingsInsights.tsx). Uten dette\n  // unntaket ble admin feilaktig m\u00f8tt med \"stengt denne dagen\" p\u00e5 alle\n  // datoer forbi grensen, selv n\u00e5r banen i realiteten var \u00e5pen.\n  const adminSession = await verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);\n  const isFullAdmin = adminSession?.role === \"full\";\n\n  if (!isFullAdmin) {\n    if (dateStr < todayInClubTimeZone()) {\n      return NextResponse.json({ date: dateStr, slots: [], closed: true, note: null });\n    }\n\n    // VIKTIG: dette er IKKE det samme som at banen er \"stengt\" denne dagen\n    // \u2013 den er fysisk \u00e5pen akkurat som vanlig, det er bare ikke lov \u00e5 booke\n    // en ENKELTTIME s\u00e5 langt frem i tid (enn\u00e5). F\u00e5r derfor sitt EGET flagg\n    // (`tooFarAhead`) i stedet for \u00e5 late som dagen er stengt, slik at\n    // bookingsiden kan vise en korrekt melding (se BookingCalendar.tsx).\n    const maxDate = await getEffectiveSingleBookingMaxDate();\n    if (maxDate !== null && dateStr > maxDate) {\n      return NextResponse.json({ date: dateStr, slots: [], closed: false, tooFarAhead: true, note: null });\n    }\n  }",
    "availability-gate-v2",
    "return NextResponse.json({ date: dateStr, slots: [], closed: false, tooFarAhead: true, note: null });",
) and ok

ok = apply_regex(
    P_BOOKINGS,
    "import\\ \\{\\ getRecurringCutoffDate,\\ getRecurringMaxWeeks\\ \\}\\ from\\ \"@/lib/settings/recurringLimit\";\\\nimport\\ \\{\\ getSingleBookingMaxDaysAhead\\ \\}\\ from\\ \"@/lib/settings/singleBookingLimit\";",
    "import { getRecurringCutoffDate, getRecurringMaxWeeks } from \"@/lib/settings/recurringLimit\";\nimport { getEffectiveSingleBookingMaxDate } from \"@/lib/settings/singleBookingLimit\";",
    "bookings-imports-v2",
    "import { getEffectiveSingleBookingMaxDate } from \"@/lib/settings/singleBookingLimit\";",
) and ok

ok = apply_regex(
    P_BOOKINGS,
    "\\ \\ if\\ \\(mode\\ ===\\ \"single\"\\)\\ \\{\\\n\\ \\ \\ \\ const\\ maxDaysAhead\\ =\\ await\\ getSingleBookingMaxDaysAhead\\(\\);\\\n\\ \\ \\ \\ if\\ \\(!isDateBookable\\(date,\\ maxDaysAhead\\)\\)\\ \\{\\\n\\ \\ \\ \\ \\ \\ return\\ NextResponse\\.json\\(\\{\\ error:\\ \"Datoen\\ er\\ ikke\\ bookbar\\.\"\\ \\},\\ \\{\\ status:\\ 400\\ \\}\\);\\\n\\ \\ \\ \\ \\}\\\n\\ \\ \\}",
    "  if (mode === \"single\") {\n    const maxDate = await getEffectiveSingleBookingMaxDate();\n    if (!isDateBookable(date, maxDate)) {\n      return NextResponse.json({ error: \"Datoen er ikke bookbar.\" }, { status: 400 });\n    }\n  }",
    "bookings-single-mode-check-v2",
    "const maxDate = await getEffectiveSingleBookingMaxDate();",
) and ok

ok = apply_regex(
    P_BC,
    "import\\ \\{\\ MAX_RECURRING_WEEKS,\\ SLOT_LENGTH_MINUTES,\\ type\\ BookingDurationMinutes\\ \\}\\ from\\ \"@/lib/config\";\\\nimport\\ \\{\\ maxBookableDate,\\ maxRecurringWeeksUntil,\\ todayInClubTimeZone\\ \\}\\ from\\ \"@/lib/slots\";",
    "import { MAX_RECURRING_WEEKS, SLOT_LENGTH_MINUTES, type BookingDurationMinutes } from \"@/lib/config\";\nimport { maxRecurringWeeksUntil, todayInClubTimeZone } from \"@/lib/slots\";",
    "bc-imports-v2",
    "import { maxRecurringWeeksUntil, todayInClubTimeZone } from \"@/lib/slots\";",
) and ok

ok = apply_regex(
    P_BC,
    "interface\\ AvailabilityResponse\\ \\{\\\n\\ \\ date:\\ string;\\\n\\ \\ slots:\\ AvailabilitySlot\\[\\];\\\n\\ \\ closed\\?:\\ boolean;\\\n\\ \\ note\\?:\\ string\\ \\|\\ null;\\\n\\ \\ error\\?:\\ string;\\\n\\}",
    "interface AvailabilityResponse {\n  date: string;\n  slots: AvailabilitySlot[];\n  closed?: boolean;\n  /** Satt (i stedet for `closed`) n\u00e5r dagen i seg selv er \u00e5pen, men ligger forbi vinduet man har lov til \u00e5 booke en enkelttime innenfor \u2013 se app/api/squash/availability/route.ts. IKKE det samme som stengt. */\n  tooFarAhead?: boolean;\n  note?: string | null;\n  error?: string;\n}",
    "bc-availabilityresponse-v2",
    "tooFarAhead?: boolean;",
) and ok

ok = apply_regex(
    P_BC,
    "interface\\ BookingCalendarProps\\ \\{\\\n\\ \\ /\\*\\*\\ Siste\\ dato\\ en\\ gjentakende\\ booking\\ har\\ lov\\ til\\ .*?\\ dekke\\ \\(satt\\ av\\ klubben\\ i\\ adminpanelet\\),\\ eller\\ null\\ for\\ ingen\\ egen\\ grense\\ .*?\\ se\\ lib/settings/recurringLimit\\.ts\\.\\ \\*/\\\n\\ \\ recurringCutoffDate:\\ string\\ \\|\\ null;\\\n\\ \\ /\\*\\*\\ Maks\\ antall\\ uker\\ i\\ en\\ enkelt\\ serie\\ \\(satt\\ av\\ klubben\\ i\\ adminpanelet\\),\\ eller\\ null\\ for\\ ingen\\ egen\\ grense\\ \\(da\\ gjelder\\ kun\\ MAX_RECURRING_WEEKS\\)\\ .*?\\ se\\ lib/settings/recurringLimit\\.ts\\.\\ Denne\\ og\\ recurringCutoffDate\\ er\\ to\\ UAVHENGIGE\\ grenser\\ som\\ begge\\ gjelder\\ samtidig\\ \\(den\\ strengeste\\ vinner\\)\\.\\ \\*/\\\n\\ \\ recurringMaxWeeks:\\ number\\ \\|\\ null;\\\n\\ \\ /\\*\\*\\ Hvor\\ mange\\ dager\\ frem\\ i\\ tid\\ en\\ enkelttime\\ har\\ lov\\ til\\ .*?\\ bookes\\ \\(satt\\ av\\ klubben\\ i\\ adminpanelet\\)\\ .*?\\ se\\ lib/settings/singleBookingLimit\\.ts\\.\\ Gjelder\\ KUN\\ kundens\\ egen,\\ selvbetjente\\ enkeltbooking\\ her\\ .*?\\ admins\\ egen\\ manuelle\\ booking\\ i\\ adminpanelet\\ er\\ unntatt\\ denne\\ grensen\\.\\ \\*/\\\n\\ \\ maxSingleBookingDaysAhead:\\ number;\\\n\\ \\ /\\*\\*\\ Dagens\\ priser\\ \\(i\\ .*?re\\),\\ satt\\ av\\ klubben\\ i\\ adminpanelet\\ .*?\\ se\\ lib/settings/pricing\\.ts\\.\\ De\\ to\\ er\\ HELT\\ uavhengige\\ av\\ hverandre\\ \\(1\\ time\\ er\\ ikke\\ n.*?dvendigvis\\ dobbelt\\ s.*?\\ dyrt\\ som\\ 30\\ min\\)\\.\\ \\*/\\\n\\ \\ price30MinOre:\\ number;\\\n\\ \\ price60MinOre:\\ number;\\\n\\}\\\n\\\nexport\\ default\\ function\\ BookingCalendar\\(\\{\\\n\\ \\ recurringCutoffDate,\\\n\\ \\ recurringMaxWeeks,\\\n\\ \\ maxSingleBookingDaysAhead,\\\n\\ \\ price30MinOre,\\\n\\ \\ price60MinOre,\\\n\\}:\\ BookingCalendarProps\\)\\ \\{\\\n\\ \\ const\\ today\\ =\\ useMemo\\(\\(\\)\\ =>\\ todayInClubTimeZone\\(\\),\\ \\[\\]\\);\\\n\\ \\ const\\ maxDate\\ =\\ useMemo\\(\\(\\)\\ =>\\ maxBookableDate\\(maxSingleBookingDaysAhead\\),\\ \\[maxSingleBookingDaysAhead\\]\\);",
    "interface BookingCalendarProps {\n  /** Siste dato en gjentakende booking har lov til \u00e5 dekke (satt av klubben i adminpanelet), eller null for ingen egen grense \u2013 se lib/settings/recurringLimit.ts. */\n  recurringCutoffDate: string | null;\n  /** Maks antall uker i en enkelt serie (satt av klubben i adminpanelet), eller null for ingen egen grense (da gjelder kun MAX_RECURRING_WEEKS) \u2013 se lib/settings/recurringLimit.ts. Denne og recurringCutoffDate er to UAVHENGIGE grenser som begge gjelder samtidig (den strengeste vinner). */\n  recurringMaxWeeks: number | null;\n  /** Den FAKTISKE siste datoen en enkelttime har lov til \u00e5 bookes, eller null for ingen grense \u2013 allerede ferdig utregnet server-side (enten et eksplisitt antall dager, eller ellers datoen for siste seriebooking) \u2013 se lib/settings/singleBookingLimit.ts sin getEffectiveSingleBookingMaxDate. Gjelder KUN kundens egen, selvbetjente enkeltbooking her \u2013 en hovedadministrator sin egen manuelle booking i adminpanelet er unntatt denne grensen. */\n  maxSingleBookingDate: string | null;\n  /** Dagens priser (i \u00f8re), satt av klubben i adminpanelet \u2013 se lib/settings/pricing.ts. De to er HELT uavhengige av hverandre (1 time er ikke n\u00f8dvendigvis dobbelt s\u00e5 dyrt som 30 min). */\n  price30MinOre: number;\n  price60MinOre: number;\n}\n\nexport default function BookingCalendar({\n  recurringCutoffDate,\n  recurringMaxWeeks,\n  maxSingleBookingDate,\n  price30MinOre,\n  price60MinOre,\n}: BookingCalendarProps) {\n  const today = useMemo(() => todayInClubTimeZone(), []);\n  const maxDate = maxSingleBookingDate ?? undefined;",
    "bc-prop-and-maxdate-v2",
    "const maxDate = maxSingleBookingDate ?? undefined;",
) and ok

ok = apply_regex(
    P_BC,
    "\\ \\ const\\ \\[closedInfo,\\ setClosedInfo\\]\\ =\\ useState<\\{\\ closed:\\ boolean;\\ note:\\ string\\ \\|\\ null\\ \\}\\ \\|\\ null>\\(null\\);",
    "  const [closedInfo, setClosedInfo] = useState<{ closed: boolean; tooFarAhead: boolean; note: string | null } | null>(null);",
    "bc-closedinfo-state-v2",
    "tooFarAhead: boolean; note: string | null } | null>(null);",
) and ok

ok = apply_regex(
    P_BC,
    "\\ \\ \\ \\ \\ \\ \\ \\ if\\ \\(data\\.error\\)\\ \\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ setErrorMessage\\(data\\.error\\);\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ setSlots\\(\\[\\]\\);\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ setClosedInfo\\(null\\);\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\}\\ else\\ \\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ setSlots\\(data\\.slots\\);\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ setClosedInfo\\(\\{\\ closed:\\ !!data\\.closed,\\ note:\\ data\\.note\\ \\?\\?\\ null\\ \\}\\);\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\}",
    "        if (data.error) {\n          setErrorMessage(data.error);\n          setSlots([]);\n          setClosedInfo(null);\n        } else {\n          setSlots(data.slots);\n          setClosedInfo({ closed: !!data.closed, tooFarAhead: !!data.tooFarAhead, note: data.note ?? null });\n        }",
    "bc-fetch-handler-v2",
    "tooFarAhead: !!data.tooFarAhead,",
) and ok

ok = apply_regex(
    P_BC,
    "\\ \\ \\ \\ \\ \\ \\ \\ \\{!loadingSlots\\ \\&\\&\\ slots\\.length\\ ===\\ 0\\ \\&\\&\\ \\(\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <p\\ className=\\{styles\\.emptyState\\}>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\{closedInfo\\?\\.closed\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\?\\ `Stengt\\ denne\\ dagen\\$\\{closedInfo\\.note\\ \\?\\ `\\ \\(\\$\\{closedInfo\\.note\\}\\)`\\ :\\ \"\"\\}\\.`\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ :\\ \"Ingen\\ bookbare\\ tider\\ denne\\ dagen\\.\"\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ </p>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\)\\}",
    "        {!loadingSlots && slots.length === 0 && (\n          <p className={styles.emptyState}>\n            {closedInfo?.tooFarAhead\n              ? \"Du kan ikke booke en enkelttime s\u00e5 langt frem i tid enda.\"\n              : closedInfo?.closed\n                ? `Stengt denne dagen${closedInfo.note ? ` (${closedInfo.note})` : \"\"}.`\n                : \"Ingen bookbare tider denne dagen.\"}\n          </p>\n        )}",
    "bc-empty-state-v2",
    "Du kan ikke booke en enkelttime s\u00e5 langt frem i tid enda.",
) and ok

ok = apply_regex(
    P_PAGE,
    "import\\ \\{\\ getSingleBookingMaxDaysAhead\\ \\}\\ from\\ \"@/lib/settings/singleBookingLimit\";",
    "import { getEffectiveSingleBookingMaxDate } from \"@/lib/settings/singleBookingLimit\";",
    "page-imports-v2",
    "import { getEffectiveSingleBookingMaxDate } from \"@/lib/settings/singleBookingLimit\";",
) and ok

ok = apply_regex(
    P_PAGE,
    "\\ \\ const\\ \\[branding,\\ recurringCutoffDate,\\ recurringMaxWeeks,\\ maxSingleBookingDaysAhead,\\ pricing,\\ pageContent\\]\\ =\\ await\\ Promise\\.all\\(\\[\\\n\\ \\ \\ \\ getBranding\\(\\),\\\n\\ \\ \\ \\ getRecurringCutoffDate\\(\\),\\\n\\ \\ \\ \\ getRecurringMaxWeeks\\(\\),\\\n\\ \\ \\ \\ getSingleBookingMaxDaysAhead\\(\\),\\\n\\ \\ \\ \\ getPricingSettings\\(\\),\\\n\\ \\ \\ \\ getPageContent\\(\\),\\\n\\ \\ \\]\\);",
    "  const [branding, recurringCutoffDate, recurringMaxWeeks, maxSingleBookingDate, pricing, pageContent] = await Promise.all([\n    getBranding(),\n    getRecurringCutoffDate(),\n    getRecurringMaxWeeks(),\n    getEffectiveSingleBookingMaxDate(),\n    getPricingSettings(),\n    getPageContent(),\n  ]);",
    "page-fetch-array-v2",
    "getEffectiveSingleBookingMaxDate(),",
) and ok

ok = apply_regex(
    P_PAGE,
    "\\ \\ \\ \\ \\ \\ <BookingCalendar\\\n\\ \\ \\ \\ \\ \\ \\ \\ recurringCutoffDate=\\{recurringCutoffDate\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ recurringMaxWeeks=\\{recurringMaxWeeks\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ maxSingleBookingDaysAhead=\\{maxSingleBookingDaysAhead\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ price30MinOre=\\{pricing\\.price30MinOre\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ price60MinOre=\\{pricing\\.price60MinOre\\}\\\n\\ \\ \\ \\ \\ \\ />",
    "      <BookingCalendar\n        recurringCutoffDate={recurringCutoffDate}\n        recurringMaxWeeks={recurringMaxWeeks}\n        maxSingleBookingDate={maxSingleBookingDate}\n        price30MinOre={pricing.price30MinOre}\n        price60MinOre={pricing.price60MinOre}\n      />",
    "page-jsx-prop-v2",
    "maxSingleBookingDate={maxSingleBookingDate}",
) and ok

ok = apply_regex(
    P_OHM,
    "import\\ \\{\\ MAX_DAYS_AHEAD,\\ MAX_RECURRING_WEEKS\\ \\}\\ from\\ \"@/lib/config\";",
    "import { MAX_RECURRING_WEEKS } from \"@/lib/config\";",
    "ohm-import-v2",
    "import { MAX_RECURRING_WEEKS } from \"@/lib/config\";",
) and ok

ok = apply_regex(
    P_OHM,
    "\\ \\ //\\ Grense\\ for\\ ENKELTTIMER\\ .*?\\ hvor\\ mange\\ dager\\ frem\\ i\\ tid\\ KUNDEN\\ selv\\ kan\\\n\\ \\ //\\ booke\\ en\\ enkelttime\\ p.*?\\ bookingsiden\\ \\(se\\\n\\ \\ //\\ lib/settings/singleBookingLimit\\.ts\\)\\.\\ Helt\\ uavhengig\\ av\\ grensene\\ for\\\n\\ \\ //\\ gjentakende\\ bookinger\\ over\\ .*?\\ admins\\ egen\\ manuelle\\ booking\\ i\\\n\\ \\ //\\ adminpanelet\\ er\\ IKKE\\ p.*?virket\\ av\\ denne\\ grensen\\ i\\ det\\ hele\\ tatt\\ \\(se\\\n\\ \\ //\\ app/api/squash/availability/route\\.ts\\)\\.\\\n\\ \\ const\\ \\[singleMaxDays,\\ setSingleMaxDays\\]\\ =\\ useState\\(\"\"\\);",
    "  // Grense for ENKELTTIMER \u2013 hvor mange dager frem i tid KUNDEN selv kan\n  // booke en enkelttime p\u00e5 bookingsiden (se\n  // lib/settings/singleBookingLimit.ts). St\u00e5r feltet tomt, gjelder i stedet\n  // datoen for siste seriebooking (cutoffDate over) som grense for\n  // enkelttimer ogs\u00e5 \u2013 det gir ingen mening at en enkelttime skal ha en\n  // STRENGERE grense enn en gjentakende booking allerede har. En\n  // hovedadministrator (rolle \"full\") er UNNTATT denne grensen helt n\u00e5r hen\n  // selv booker i adminpanelet (se app/api/squash/availability/route.ts) \u2013\n  // en begrenset \"bookings_only\"-administrator er derimot bundet av samme\n  // grense som kunden.\n  const [singleMaxDays, setSingleMaxDays] = useState(\"\");",
    "ohm-comment-v2",
    "hovedadministrator (rolle \"full\") er UNNTATT denne grensen helt n\u00e5r hen",
) and ok

ok = apply_regex(
    P_OHM,
    "\\ \\ useEffect\\(\\(\\)\\ =>\\ \\{\\\n\\ \\ \\ \\ fetch\\(\"/api/admin/settings/single\\-booking\\-limit\",\\ \\{\\ cache:\\ \"no\\-store\"\\ \\}\\)\\\n\\ \\ \\ \\ \\ \\ \\.then\\(\\(res\\)\\ =>\\ \\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ if\\ \\(!res\\.ok\\)\\ throw\\ new\\ Error\\(\"Kunne\\ ikke\\ hente\\ grensen\\.\"\\);\\\n\\ \\ \\ \\ \\ \\ \\ \\ return\\ res\\.json\\(\\)\\ as\\ Promise<\\{\\ maxDaysAhead:\\ number\\ \\}>;\\\n\\ \\ \\ \\ \\ \\ \\}\\)\\\n\\ \\ \\ \\ \\ \\ \\.then\\(\\(data\\)\\ =>\\ \\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ setSingleMaxDays\\(String\\(data\\.maxDaysAhead\\)\\);\\\n\\ \\ \\ \\ \\ \\ \\}\\)\\\n\\ \\ \\ \\ \\ \\ \\.catch\\(\\(\\)\\ =>\\ \\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ //\\ Ikke\\ kritisk\\ nok\\ til\\ .*?\\ blokkere\\ resten\\ av\\ siden\\ .*?\\ feltet\\ starter\\ bare\\ tomt\\.\\\n\\ \\ \\ \\ \\ \\ \\}\\)\\\n\\ \\ \\ \\ \\ \\ \\.finally\\(\\(\\)\\ =>\\ setSingleMaxDaysLoading\\(false\\)\\);\\\n\\ \\ \\},\\ \\[\\]\\);",
    "  useEffect(() => {\n    fetch(\"/api/admin/settings/single-booking-limit\", { cache: \"no-store\" })\n      .then((res) => {\n        if (!res.ok) throw new Error(\"Kunne ikke hente grensen.\");\n        return res.json() as Promise<{ maxDaysAhead: number | null }>;\n      })\n      .then((data) => {\n        setSingleMaxDays(data.maxDaysAhead != null ? String(data.maxDaysAhead) : \"\");\n      })\n      .catch(() => {\n        // Ikke kritisk nok til \u00e5 blokkere resten av siden \u2013 feltet starter bare tomt.\n      })\n      .finally(() => setSingleMaxDaysLoading(false));\n  }, []);",
    "ohm-effect-v2",
    "setSingleMaxDays(data.maxDaysAhead != null ? String(data.maxDaysAhead) : \"\");",
) and ok

ok = apply_regex(
    P_OHM,
    "\\ \\ async\\ function\\ handleResetSingleMaxDays\\(\\)\\ \\{\\\n\\ \\ \\ \\ setSavingSingleMaxDays\\(true\\);\\\n\\ \\ \\ \\ setSingleMaxDaysMessage\\(null\\);\\\n\\\n\\ \\ \\ \\ try\\ \\{\\\n\\ \\ \\ \\ \\ \\ const\\ res\\ =\\ await\\ fetch\\(\"/api/admin/settings/single\\-booking\\-limit\",\\ \\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ method:\\ \"POST\",\\\n\\ \\ \\ \\ \\ \\ \\ \\ headers:\\ \\{\\ \"Content\\-Type\":\\ \"application/json\"\\ \\},\\\n\\ \\ \\ \\ \\ \\ \\ \\ body:\\ JSON\\.stringify\\(\\{\\ maxDaysAhead:\\ null\\ \\}\\),\\\n\\ \\ \\ \\ \\ \\ \\}\\);\\\n\\ \\ \\ \\ \\ \\ const\\ data\\ =\\ \\(await\\ res\\.json\\(\\)\\)\\ as\\ \\{\\ error\\?:\\ string;\\ maxDaysAhead\\?:\\ number\\ \\};\\\n\\ \\ \\ \\ \\ \\ if\\ \\(!res\\.ok\\)\\ \\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ setSingleMaxDaysMessage\\(\\{\\ ok:\\ false,\\ text:\\ data\\.error\\ \\?\\?\\ \"Kunne\\ ikke\\ tilbakestille\\.\"\\ \\}\\);\\\n\\ \\ \\ \\ \\ \\ \\ \\ return;\\\n\\ \\ \\ \\ \\ \\ \\}\\\n\\ \\ \\ \\ \\ \\ setSingleMaxDays\\(typeof\\ data\\.maxDaysAhead\\ ===\\ \"number\"\\ \\?\\ String\\(data\\.maxDaysAhead\\)\\ :\\ \"\"\\);\\\n\\ \\ \\ \\ \\ \\ setSingleMaxDaysMessage\\(\\{\\ ok:\\ true,\\ text:\\ `Tilbakestilt\\ til\\ \\$\\{MAX_DAYS_AHEAD\\}\\ dager\\.`\\ \\}\\);\\\n\\ \\ \\ \\ \\}\\ catch\\ \\{\\\n\\ \\ \\ \\ \\ \\ setSingleMaxDaysMessage\\(\\{\\ ok:\\ false,\\ text:\\ \"Kunne\\ ikke\\ tilbakestille\\ akkurat\\ n.*?\\.\"\\ \\}\\);\\\n\\ \\ \\ \\ \\}\\ finally\\ \\{\\\n\\ \\ \\ \\ \\ \\ setSavingSingleMaxDays\\(false\\);\\\n\\ \\ \\ \\ \\}\\\n\\ \\ \\}",
    "  async function handleResetSingleMaxDays() {\n    setSavingSingleMaxDays(true);\n    setSingleMaxDaysMessage(null);\n\n    try {\n      const res = await fetch(\"/api/admin/settings/single-booking-limit\", {\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" },\n        body: JSON.stringify({ maxDaysAhead: null }),\n      });\n      const data = (await res.json()) as { error?: string };\n      if (!res.ok) {\n        setSingleMaxDaysMessage({ ok: false, text: data.error ?? \"Kunne ikke fjerne.\" });\n        return;\n      }\n      setSingleMaxDays(\"\");\n      setSingleMaxDaysMessage({ ok: true, text: \"Grense fjernet \u2013 bruker n\u00e5 datoen for siste seriebooking.\" });\n    } catch {\n      setSingleMaxDaysMessage({ ok: false, text: \"Kunne ikke fjerne akkurat n\u00e5.\" });\n    } finally {\n      setSavingSingleMaxDays(false);\n    }\n  }",
    "ohm-handler-v2",
    "bruker n\u00e5 datoen for siste seriebooking",
) and ok

ok = apply_regex(
    P_OHM,
    "\\ \\ \\ \\ \\ \\ \\ \\ <h2\\ style=\\{\\{\\ marginTop:\\ 0,\\ fontSize:\\ \"1\\.1rem\"\\ \\}\\}>Grense\\ for\\ enkelttimer</h2>\\\n\\ \\ \\ \\ \\ \\ \\ \\ <p\\ className=\\{styles\\.bookingMeta\\}>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ Hvor\\ mange\\ dager\\ frem\\ i\\ tid\\ KUNDEN\\ selv\\ kan\\ booke\\ en\\ enkelttime\\ p.*?\\ bookingsiden\\.\\ Helt\\ uavhengig\\ av\\ grensene\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ for\\ gjentakende\\ bookinger\\ over\\ .*?\\ p.*?virker\\ IKKE\\ admins\\ egen\\ manuelle\\ booking\\ her\\ i\\ adminpanelet,\\ som\\ alltid\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ kan\\ booke\\ like\\ langt\\ frem\\ i\\ tid\\ som\\ .*?pningstidene\\ og\\ kalenderen\\ tillater\\.\\\n\\ \\ \\ \\ \\ \\ \\ \\ </p>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\{singleMaxDaysLoading\\ \\?\\ \\(\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <p>Laster\\ .*?</p>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\)\\ :\\ \\(\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <form\\ onSubmit=\\{handleSaveSingleMaxDays\\}\\ className=\\{styles\\.form\\}>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <div\\ className=\\{styles\\.formRow\\}>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <label\\ htmlFor=\"single\\-max\\-days\">Antall\\ dager\\ frem\\ i\\ tid</label>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <input\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ id=\"single\\-max\\-days\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ type=\"number\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ min=\\{1\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ value=\\{singleMaxDays\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ onChange=\\{\\(e\\)\\ =>\\ setSingleMaxDays\\(e\\.target\\.value\\)\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ />\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ </div>\\\n\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\{singleMaxDaysMessage\\ \\&\\&\\ \\(\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <p\\ className=\\{singleMaxDaysMessage\\.ok\\ \\?\\ styles\\.success\\ :\\ styles\\.error\\}>\\{singleMaxDaysMessage\\.text\\}</p>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\)\\}\\\n\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <div\\ style=\\{\\{\\ display:\\ \"flex\",\\ gap:\\ \"8px\",\\ flexWrap:\\ \"wrap\"\\ \\}\\}>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <button\\ type=\"submit\"\\ className=\\{styles\\.submitButton\\}\\ disabled=\\{savingSingleMaxDays\\ \\|\\|\\ !singleMaxDays\\}>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\{savingSingleMaxDays\\ \\?\\ \"Lagrer\\ .*?\"\\ :\\ \"Lagre\"\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ </button>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <button\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ type=\"button\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ className=\\{styles\\.dangerButton\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ disabled=\\{savingSingleMaxDays\\ \\|\\|\\ !singleMaxDays\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ onClick=\\{handleResetSingleMaxDays\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ >\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ Tilbakestill\\ til\\ \\{MAX_DAYS_AHEAD\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ </button>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ </div>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ </form>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\)\\}\\\n\\ \\ \\ \\ \\ \\ </div>",
    "        <h2 style={{ marginTop: 0, fontSize: \"1.1rem\" }}>Grense for enkelttimer</h2>\n        <p className={styles.bookingMeta}>\n          Hvor mange dager frem i tid KUNDEN selv kan booke en enkelttime p\u00e5 bookingsiden. La feltet st\u00e5 tomt for \u00e5\n          bruke datoen for siste seriebooking over i stedet \u2013 en enkelttime skal aldri ha en strengere grense enn en\n          gjentakende booking allerede har. P\u00e5virker IKKE en hovedadministrator sin egen manuelle booking her i\n          adminpanelet, som alltid kan booke like langt frem i tid som \u00e5pningstidene og kalenderen tillater \u2013 en\n          begrenset administrator er derimot bundet av samme grense som kunden.\n        </p>\n        {singleMaxDaysLoading ? (\n          <p>Laster \u2026</p>\n        ) : (\n          <form onSubmit={handleSaveSingleMaxDays} className={styles.form}>\n            <div className={styles.formRow}>\n              <label htmlFor=\"single-max-days\">Antall dager frem i tid</label>\n              <input\n                id=\"single-max-days\"\n                type=\"number\"\n                min={1}\n                placeholder=\"Tomt = bruk datoen for siste seriebooking\"\n                value={singleMaxDays}\n                onChange={(e) => setSingleMaxDays(e.target.value)}\n              />\n            </div>\n\n            {singleMaxDaysMessage && (\n              <p className={singleMaxDaysMessage.ok ? styles.success : styles.error}>{singleMaxDaysMessage.text}</p>\n            )}\n\n            <div style={{ display: \"flex\", gap: \"8px\", flexWrap: \"wrap\" }}>\n              <button type=\"submit\" className={styles.submitButton} disabled={savingSingleMaxDays || !singleMaxDays}>\n                {savingSingleMaxDays ? \"Lagrer \u2026\" : \"Lagre\"}\n              </button>\n              <button\n                type=\"button\"\n                className={styles.dangerButton}\n                disabled={savingSingleMaxDays || !singleMaxDays}\n                onClick={handleResetSingleMaxDays}\n              >\n                Fjern grense\n              </button>\n            </div>\n          </form>\n        )}\n      </div>",
    "ohm-jsx-card-v2",
    "Tomt = bruk datoen for siste seriebooking",
) and ok

ok = write_full_file(
    P_SINGLE_LIMIT,
    "import \"server-only\";\nimport { getRepository } from \"@/lib/db\";\nimport { maxBookableDate } from \"@/lib/slots\";\nimport { getRecurringCutoffDate } from \"@/lib/settings/recurringLimit\";\n\n/**\n * Hvor mange dager frem i tid en kunde har lov til \u00e5 booke en enkelttime \u2013\n * satt av klubben i adminpanelet (se\n * app/admin/opening-hours/OpeningHoursManager.tsx, kortet \"Grense for\n * enkelttimer\"). Lagret i den samme generiske n\u00f8kkel/verdi-\n * innstillingstabellen som resten av innstillingene (se\n * lib/settings/recurringLimit.ts for samme m\u00f8nster).\n *\n * `null`/ikke satt betyr at INGEN eksplisitt antall dager er valgt \u2013 da\n * gjelder i stedet datoen for siste seriebooking (recurringCutoffDate, se\n * lib/settings/recurringLimit.ts) som den faktiske grensen for\n * enkelttimer ogs\u00e5, se getEffectiveSingleBookingMaxDate under. Det var\n * tidligere en HARDKODET konstant (MAX_DAYS_AHEAD i lib/config.ts, 14\n * dager) som gjaldt uansett \u2013 men siden en dag forbi et slikt vindu verken\n * er \"stengt\" eller gir mening som STRENGERE enn grensen en gjentakende\n * booking allerede har, er MAX_DAYS_AHEAD ikke lenger i bruk her i det\n * hele tatt.\n *\n * En \"hovedadministrator\" (rolle \"full\", se AdminRole i lib/db/types.ts)\n * er UNNTATT denne grensen helt n\u00e5r hen selv booker (se\n * app/api/squash/availability/route.ts). En begrenset \"bookings_only\"-\n * administrator er derimot bundet av samme grense som kunden.\n */\nconst KEY = \"singleBookingMaxDaysAhead\";\n\n/** Mest en enkelttime kan ha lov til \u00e5 bookes frem i tid \u2013 en romslig, men ikke ubegrenset, teknisk grense (~10 \u00e5r) mot feilinntastinger. */\nconst MAX_ALLOWED_DAYS_AHEAD = 3650;\n\n/**\n * Den r\u00e5, lagrede verdien \u2013 antall dager, eller `null` hvis feltet st\u00e5r\n * tomt (da brukes datoen for siste seriebooking i stedet, se\n * getEffectiveSingleBookingMaxDate under). Brukes KUN av selve\n * innstillingsskjemaet (se\n * app/api/admin/settings/single-booking-limit/route.ts) \u2013 all FAKTISK\n * h\u00e5ndheving av grensen skal bruke getEffectiveSingleBookingMaxDate, ikke\n * denne direkte.\n */\nexport async function getSingleBookingMaxDaysAhead(): Promise<number | null> {\n  const repo = await getRepository();\n  const raw = await repo.getSetting(KEY);\n  if (!raw) return null;\n  const n = Number(raw);\n  return Number.isInteger(n) && n >= 1 && n <= MAX_ALLOWED_DAYS_AHEAD ? n : null;\n}\n\n/**\n * `days: null` fjerner innstillingen igjen (tilbake til \"bruk datoen for\n * siste seriebooking\"). Kaster med en norsk feilmelding ved et ugyldig\n * antall.\n */\nexport async function saveSingleBookingMaxDaysAhead(days: number | null): Promise<number | null> {\n  const repo = await getRepository();\n\n  if (days === null) {\n    await repo.setSetting(KEY, \"\");\n    return null;\n  }\n\n  if (!Number.isInteger(days) || days < 1 || days > MAX_ALLOWED_DAYS_AHEAD) {\n    throw new Error(`Ugyldig antall dager (m\u00e5 v\u00e6re et helt tall mellom 1 og ${MAX_ALLOWED_DAYS_AHEAD}).`);\n  }\n\n  await repo.setSetting(KEY, String(days));\n  return days;\n}\n\n/**\n * Den FAKTISKE siste datoen en enkelttime har lov til \u00e5 bookes, som\n * \"YYYY-MM-DD\" \u2013 eller `null` for ingen grense i det hele tatt:\n *  1) Er et eksplisitt antall dager satt (se getSingleBookingMaxDaysAhead\n *     over)? Bruk det \u2013 i dag + det antallet dager.\n *  2) Ellers, er en siste dato for seriebookinger satt (recurringCutoffDate,\n *     se lib/settings/recurringLimit.ts)? Bruk DEN datoen direkte \u2013 det gir\n *     ingen mening at en enkelttime skal ha en STRENGERE grense enn en\n *     gjentakende booking allerede har.\n *  3) Ellers: ingen grense (`null`) \u2013 akkurat som en gjentakende booking\n *     uten satt cutoff-dato heller ikke har noen absolutt siste dato.\n */\nexport async function getEffectiveSingleBookingMaxDate(): Promise<string | null> {\n  const [daysAhead, cutoffDate] = await Promise.all([getSingleBookingMaxDaysAhead(), getRecurringCutoffDate()]);\n  if (daysAhead != null) return maxBookableDate(daysAhead);\n  return cutoffDate;\n}\n",
    "single-booking-limit-rewrite-v2",
    "getEffectiveSingleBookingMaxDate",
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
