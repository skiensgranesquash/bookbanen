#!/usr/bin/env python3
"""
Automatisk generert av generate.py (blockstyling) - IKKE rediger denne filen direkte.

Endrer blokkering-visningen i admin-kalenderen:
 - Hele dagen blokkert -> hele dag-ruten blir rod, ikke en '00:00 ...'-lapp
 - Tidsavgrenset blokkering viser na fra-til-klokkeslett (f.eks. 15:08-16:08)
 - Rod farge (samme som gjennomstreket/mislyktes) i stedet for brun
 - En fjernet blokkering forsvinner helt i stedet for a vises gjennomstreket

Idempotent: hvert steg hopper over seg selv hvis allerede gjort.
Kjor fra prosjektroten: python3 scripts/deploy_block_styling.py
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

ok = True

def apply_edit(path, old, new, marker, label):
    global ok
    text = path.read_text()
    if marker in text:
        print(f"[already done] {label}")
        return
    if text.count(old) != 1:
        print(f"[SKIPPED - ikke funnet/entydig] {label}")
        ok = False
        return
    path.write_text(text.replace(old, new, 1))
    print(f"[OK] {label}")

BI_PATH = ROOT / 'app' / 'admin' / 'BookingsInsights.tsx'
apply_edit(BI_PATH, 'interface Occurrence {\n  /** Id-en til BookingRow-gruppen denne forekomsten hører til – brukt til å avlyse/redigere riktig booking. */\n  id: string;\n  dateStr: string;\n  timeLabel: string;\n  label: string;', 'interface Occurrence {\n  /** Id-en til BookingRow-gruppen denne forekomsten hører til – brukt til å avlyse/redigere riktig booking. */\n  id: string;\n  dateStr: string;\n  timeLabel: string;\n  /** Sluttidspunkt ("HH:mm") for akkurat DENNE forekomsten – brukt til å vise et fra–til-klokkeslett for blokkeringer (se flattenOccurrences). */\n  endTimeLabel: string;\n  label: string;', 'endTimeLabel: string;', 'bi-interface-endtimelabel')
apply_edit(BI_PATH, '    for (const slot of booking.slots) {\n      const dateStr = formatOslo(slot.startTime, "yyyy-MM-dd");\n      const timeLabel = formatOslo(slot.startTime, "HH:mm");\n      const durationMinutes = Math.round(\n        (new Date(slot.endTime).getTime() - new Date(slot.startTime).getTime()) / 60_000\n      );\n      const failed = booking.status === "cancelled" || booking.status === "expired";\n      const shortText = booking.kind === "block" ? booking.note ?? "Blokkert" : booking.customerName;\n      const label =\n        booking.kind === "block" ? `🔧 ${shortText} kl. ${timeLabel}` : `${booking.customerName} kl. ${timeLabel}`;\n      const statusClass = failed\n        ? styles.bcEventLineFailed\n        : booking.kind === "block"\n          ? styles.bcEventLineBlock\n          : booking.status === "pending"\n            ? styles.bcEventLinePending\n            : "";\n\n      result.push({\n        id: booking.id,\n        dateStr,\n        timeLabel,\n        label,\n        failed,\n        shortText,\n        statusClass,\n        status: booking.status,\n        kind: booking.kind,\n        customerName: booking.customerName,\n        customerPhone: booking.customerPhone,\n        durationMinutes,\n      });\n    }', '    for (const slot of booking.slots) {\n      const dateStr = formatOslo(slot.startTime, "yyyy-MM-dd");\n      const timeLabel = formatOslo(slot.startTime, "HH:mm");\n      const endTimeLabel = formatOslo(slot.endTime, "HH:mm");\n      const durationMinutes = Math.round(\n        (new Date(slot.endTime).getTime() - new Date(slot.startTime).getTime()) / 60_000\n      );\n      const failed = booking.status === "cancelled" || booking.status === "expired";\n      const shortText = booking.kind === "block" ? booking.note ?? "Blokkert" : booking.customerName;\n      // En "hele dagen"-blokkering (se app/api/admin/block/route.ts) lagres\n      // fra 00:00 til 00:00 NESTE dag, altså 1440 minutter – da gir verken\n      // "kl. 00:00" eller et fra–til-klokkeslett noen mening, så den får sin\n      // egen tekst. En vanlig (klokkeslett-avgrenset) blokkering viser nå\n      // fra–til i stedet for bare START-tidspunktet, siden f.eks. "15:08"\n      // alene ikke forteller om den varer 10 minutter eller resten av dagen.\n      const isWholeDayBlock = booking.kind === "block" && durationMinutes >= 1440;\n      const label =\n        booking.kind === "block"\n          ? isWholeDayBlock\n            ? `🔧 ${shortText} (hele dagen)`\n            : `🔧 ${shortText} kl. ${timeLabel}–${endTimeLabel}`\n          : `${booking.customerName} kl. ${timeLabel}`;\n      const statusClass = failed\n        ? styles.bcEventLineFailed\n        : booking.kind === "block"\n          ? styles.bcEventLineBlock\n          : booking.status === "pending"\n            ? styles.bcEventLinePending\n            : "";\n\n      result.push({\n        id: booking.id,\n        dateStr,\n        timeLabel,\n        endTimeLabel,\n        label,\n        failed,\n        shortText,\n        statusClass,\n        status: booking.status,\n        kind: booking.kind,\n        customerName: booking.customerName,\n        customerPhone: booking.customerPhone,\n        durationMinutes,\n      });\n    }', 'isWholeDayBlock = booking.kind', 'bi-flatten-occurrences')
apply_edit(BI_PATH, '  const calendarOccurrences = useMemo(\n    () => flattenOccurrences(bookings, ["pending", "confirmed", "cancelled", "expired"]),\n    [bookings]\n  );', '  // En FJERNET blokkering (status "cancelled" – se handleAgendaCancel/onCancel\n  // under) skal bare forsvinne helt, ikke vises gjennomstreket slik en ekte\n  // avlyst/utløpt KUNDEbooking gjør – den historikken er nyttig for kunder,\n  // men ikke for admin sine egne blokkeringer. Filtreres derfor bort her, ETT\n  // sted, slik at den uansett ikke dukker opp verken i kalenderen eller i\n  // agenda-panelet ved siden av.\n  const calendarOccurrences = useMemo(\n    () =>\n      flattenOccurrences(bookings, ["pending", "confirmed", "cancelled", "expired"]).filter(\n        (occ) => !(occ.kind === "block" && occ.failed)\n      ),\n    [bookings]\n  );', 'occ.kind === "block" && occ.failed', 'bi-calendar-occurrences-filter')
apply_edit(BI_PATH, '              const dayOccurrences = occurrencesByDate.get(dateStr) ?? [];\n              const { visible, hiddenCount } = pickVisibleForDay(dayOccurrences);', '              const dayOccurrences = occurrencesByDate.get(dateStr) ?? [];\n              // En "hele dagen"-blokkering dekker (se kommentaren i\n              // flattenOccurrences over) fra 00:00 til 00:00 neste dag – i\n              // stedet for å vise den som en forvirrende "00:00 ..."-lapp\n              // blant de andre oppføringene, farges HELE dag-ruten rød (se\n              // bcDayBlocked under) og selve lappen utelates fra listen –\n              // cellens egen farge forteller allerede at dagen er full.\n              const wholeDayBlocks = dayOccurrences.filter((o) => o.kind === "block" && o.durationMinutes >= 1440);\n              const isWholeDayBlocked = wholeDayBlocks.length > 0;\n              const pillOccurrences = isWholeDayBlocked\n                ? dayOccurrences.filter((o) => !(o.kind === "block" && o.durationMinutes >= 1440))\n                : dayOccurrences;\n              const { visible, hiddenCount } = pickVisibleForDay(pillOccurrences);', 'const wholeDayBlocks = dayOccurrences.filter', 'bi-daycell-wholeday-calc')
apply_edit(BI_PATH, '              if (isClosedDay) classNames.push(styles.bcDayClosed);', '              if (isClosedDay) classNames.push(styles.bcDayClosed);\n              if (isWholeDayBlocked) classNames.push(styles.bcDayBlocked);', 'styles.bcDayBlocked', 'bi-daycell-classnames')
apply_edit(BI_PATH, '                      {visible.map((occ, i) => (\n                        <span key={i} className={`${styles.bcEntry} ${entryClassFor(occ)}`}>\n                          {occ.timeLabel} {occ.shortText}\n                        </span>\n                      ))}', '                      {visible.map((occ, i) => (\n                        <span key={i} className={`${styles.bcEntry} ${entryClassFor(occ)}`}>\n                          {occ.kind === "block" ? `${occ.timeLabel}–${occ.endTimeLabel}` : occ.timeLabel} {occ.shortText}\n                        </span>\n                      ))}', 'occ.kind === "block" ? `${occ.timeLabel}', 'bi-daycell-pill-render')
apply_edit(BI_PATH, '            <span>\n              <span className={styles.calLegendDot} style={{ background: "#b45309" }} />\n              Blokkert\n            </span>', '            <span>\n              <span className={styles.calLegendDot} style={{ background: "var(--danger-dark)" }} />\n              Blokkert\n            </span>', 'style={{ background: "var(--danger-dark)" }} />\n              Blokkert', 'bi-legend-blokkert-color')

CSS_PATH = ROOT / 'app' / 'admin' / 'admin.module.css'
apply_edit(CSS_PATH, '.bcDayClosed .bcDayNumber {\n  color: var(--danger-dark);\n}\n\n.bcDayToday {', '.bcDayClosed .bcDayNumber {\n  color: var(--danger-dark);\n}\n\n/** Hele dagen er blokkert av admin (se wholeDayBlocks/isWholeDayBlocked i\n    BookingsInsights.tsx) – samme røde visuelle språk som bcDayClosed over,\n    men en egen klasse siden de to betyr ulike ting (stengt vs. blokkert av\n    admin). */\n.bcDayBlocked {\n  background: var(--conflict-bg);\n}\n\n.bcDayBlocked .bcDayNumber {\n  color: var(--danger-dark);\n}\n\n.bcDayToday {', '.bcDayBlocked {', 'css-bcdayblocked')
apply_edit(CSS_PATH, '.bcEntryBlock {\n  background: #b45309;\n  color: white;\n}', '.bcEntryBlock {\n  background: var(--conflict-bg);\n  color: var(--danger-dark);\n  border-color: var(--conflict-border);\n}', 'bcEntryBlock {\n  background: var(--conflict-bg);', 'css-bcentryblock-red')
apply_edit(CSS_PATH, '.agendaRow.bcEventLineBlock {\n  background: var(--surface);\n  border-color: var(--border);\n  color: #b45309;\n}', '.agendaRow.bcEventLineBlock {\n  background: var(--conflict-bg);\n  border-color: var(--conflict-border);\n  color: var(--danger-dark);\n}', 'bcEventLineBlock {\n  background: var(--conflict-bg);', 'css-agendablock-red')

if not ok:
    print("\nEtt eller flere steg feilet - avbryter FOR typecheck (ingenting antas trygt).")
    sys.exit(1)

print("\nKjorer typecheck ...")
result = subprocess.run(["npm", "run", "typecheck"], cwd=ROOT)
if result.returncode == 0:
    print("\nTYPECHECK OK")
else:
    print("\nTYPECHECK FEILET")
    sys.exit(1)
