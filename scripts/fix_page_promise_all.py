import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(".").resolve()
P_PAGE = ROOT / "app" / "page.tsx"


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


ok = True

ok = apply_regex(
    P_PAGE,
    "\\ \\ const\\ \\[branding,\\ recurringCutoffDate,\\ recurringMaxWeeks,\\ pricing,\\ pageContent\\]\\ =\\ await\\ Promise\\.all\\(\\[\\\n\\ \\ \\ \\ getBranding\\(\\),\\\n\\ \\ \\ \\ getRecurringCutoffDate\\(\\),\\\n\\ \\ \\ \\ getRecurringMaxWeeks\\(\\),\\\n\\ \\ \\ \\ getPricingSettings\\(\\),\\\n\\ \\ \\ \\ getPageContent\\(\\),\\\n\\ \\ \\]\\);",
    "  const [branding, recurringCutoffDate, recurringMaxWeeks, maxSingleBookingDaysAhead, pricing, pageContent] = await Promise.all([\n    getBranding(),\n    getRecurringCutoffDate(),\n    getRecurringMaxWeeks(),\n    getSingleBookingMaxDaysAhead(),\n    getPricingSettings(),\n    getPageContent(),\n  ]);",
    "page-fetch-array-fix",
    "getSingleBookingMaxDaysAhead(),",
) and ok

print()
if not ok:
    print("STEG BLE HOPPET OVER - se [SKIPPED]-meldingen over. Si fra til Claude.")
    print("Ingenting annet ble kjort (ingen typecheck).")
    sys.exit(1)

print("Endringen er lagt inn (eller var allerede gjort fra for).")
print()
print("Kjorer \"npm run typecheck\" for a sjekke at alt fortsatt kompilerer riktig ...")
print()
result = subprocess.run(["npm", "run", "typecheck"], cwd=ROOT)
print()
if result.returncode == 0:
    print("TYPECHECK OK - alt kompilerer. Endringen er ferdig lagt inn.")
else:
    print("TYPECHECK FEILET - se TypeScript-feilmeldingene over. Si fra til Claude, ikke deploy enda.")
    sys.exit(1)
