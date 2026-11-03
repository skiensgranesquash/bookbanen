import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(".").resolve()
P_PAYMENTS_TYPES = ROOT / "lib" / "payments" / "types.ts"
P_VIPPS = ROOT / "lib" / "payments" / "vipps.ts"
P_VIPPS_FORM = ROOT / "app" / "admin" / "settings" / "VippsSettingsForm.tsx"
P_BI = ROOT / "app" / "admin" / "BookingsInsights.tsx"
P_MANUAL = ROOT / "app" / "api" / "admin" / "bookings" / "manual" / "route.ts"
P_ADMIN_PAYMENT_HOLD = ROOT / "lib" / "settings" / "adminPaymentHold.ts"
P_PAYMENT_HOLD_ROUTE = ROOT / "app" / "api" / "admin" / "settings" / "payment-hold" / "route.ts"


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
    P_PAYMENTS_TYPES,
    "export\\ interface\\ CreatePaymentInput\\ \\{\\\n\\ \\ reference:\\ string;\\\n\\ \\ amountOre:\\ number;\\\n\\ \\ /\\*\\*\\ Norsk\\ mobilnummer\\ uten\\ landkode,\\ f\\.eks\\.\\ \"91234567\"\\.\\ \\*/\\\n\\ \\ phoneNumber:\\ string;\\\n\\ \\ description:\\ string;\\\n\\ \\ returnUrl:\\ string;\\\n\\}",
    "export interface CreatePaymentInput {\n  reference: string;\n  amountOre: number;\n  /** Norsk mobilnummer uten landkode, f.eks. \"91234567\". */\n  phoneNumber: string;\n  description: string;\n  returnUrl: string;\n  /**\n   * \"WEB_REDIRECT\" (standard, brukes hvis utelatt) = brukeren \u00e5pner en lenke\n   * i egen nettleser og godkjenner der - slik den offentlige bookingsiden\n   * alltid gj\u00f8r. \"PUSH_MESSAGE\" = betalingsforesp\u00f8rselen sendes rett til\n   * Vipps-appen p\u00e5 telefonnummeret over, uten noen lenke - brukt n\u00e5r ADMIN\n   * oppretter bookingen og ber om betaling p\u00e5 vegne av kunden (se\n   * app/api/admin/bookings/manual/route.ts), siden kunden selv ikke sitter i\n   * noen nettleser akkurat da. Merk: Vipps krever normalt at salgsenheten\n   * (MSN) er egen-godkjent av dem for push-varianten i PRODUKSJON (fungerer\n   * fritt i test-milj\u00f8et) - se lib/payments/vipps.ts.\n   */\n  userFlow?: \"WEB_REDIRECT\" | \"PUSH_MESSAGE\";\n}",
    "payments-types-userFlow",
    "userFlow?: \"WEB_REDIRECT\" | \"PUSH_MESSAGE\";",
) and ok

ok = apply_regex(
    P_VIPPS,
    "async\\ function\\ rawCreatePayment\\(input:\\ CreatePaymentInput\\):\\ Promise<RawCreatePaymentResult>\\ \\{\\\n\\ \\ return\\ vippsFetch<RawCreatePaymentResult>\\(\"/epayment/v1/payments\",\\ \\{\\\n\\ \\ \\ \\ method:\\ \"POST\",\\\n\\ \\ \\ \\ idempotencyKey:\\ input\\.reference,\\\n\\ \\ \\ \\ body:\\ JSON\\.stringify\\(\\{\\\n\\ \\ \\ \\ \\ \\ amount:\\ \\{\\ currency:\\ \"NOK\",\\ value:\\ input\\.amountOre\\ \\},\\\n\\ \\ \\ \\ \\ \\ paymentMethod:\\ \\{\\ type:\\ \"WALLET\"\\ \\},\\\n\\ \\ \\ \\ \\ \\ reference:\\ input\\.reference,\\\n\\ \\ \\ \\ \\ \\ userFlow:\\ \"WEB_REDIRECT\",\\\n\\ \\ \\ \\ \\ \\ returnUrl:\\ input\\.returnUrl,\\\n\\ \\ \\ \\ \\ \\ paymentDescription:\\ input\\.description,\\\n\\ \\ \\ \\ \\ \\ customer:\\ \\{\\ phoneNumber:\\ toVippsPhoneNumber\\(input\\.phoneNumber\\)\\ \\},\\\n\\ \\ \\ \\ \\}\\),\\\n\\ \\ \\}\\);\\\n\\}",
    "async function rawCreatePayment(input: CreatePaymentInput): Promise<RawCreatePaymentResult> {\n  return vippsFetch<RawCreatePaymentResult>(\"/epayment/v1/payments\", {\n    method: \"POST\",\n    idempotencyKey: input.reference,\n    body: JSON.stringify({\n      amount: { currency: \"NOK\", value: input.amountOre },\n      paymentMethod: { type: \"WALLET\" },\n      reference: input.reference,\n      userFlow: input.userFlow ?? \"WEB_REDIRECT\",\n      returnUrl: input.returnUrl,\n      paymentDescription: input.description,\n      customer: { phoneNumber: toVippsPhoneNumber(input.phoneNumber) },\n    }),\n  });\n}",
    "vipps-userFlow",
    "userFlow: input.userFlow ?? \"WEB_REDIRECT\",",
) and ok

ok = apply_regex(
    P_VIPPS_FORM,
    "\\ \\ const\\ \\[activating,\\ setActivating\\]\\ =\\ useState\\(false\\);\\\n\\ \\ const\\ \\[activateMessage,\\ setActivateMessage\\]\\ =\\ useState<\\{\\ ok:\\ boolean;\\ text:\\ string\\ \\}\\ \\|\\ null>\\(null\\);",
    "  const [activating, setActivating] = useState(false);\n  const [activateMessage, setActivateMessage] = useState<{ ok: boolean; text: string } | null>(null);\n\n  const [paymentHoldMinutes, setPaymentHoldMinutes] = useState(10);\n  const [paymentHoldLoading, setPaymentHoldLoading] = useState(true);\n  const [savingPaymentHold, setSavingPaymentHold] = useState(false);\n  const [paymentHoldMessage, setPaymentHoldMessage] = useState<{ ok: boolean; text: string } | null>(null);",
    "form-state",
    "const [paymentHoldMinutes, setPaymentHoldMinutes] = useState(10);",
) and ok

ok = apply_regex(
    P_VIPPS_FORM,
    "\\ \\ useEffect\\(\\(\\)\\ =>\\ \\{\\\n\\ \\ \\ \\ loadStatus\\(\\);\\\n\\ \\ \\ \\ if\\ \\(typeof\\ window\\ !==\\ \"undefined\"\\)\\ \\{\\\n\\ \\ \\ \\ \\ \\ setCallbackUrl\\(`\\$\\{window\\.location\\.origin\\}/api/squash/vipps\\-webhook`\\);\\\n\\ \\ \\ \\ \\}\\\n\\ \\ \\},\\ \\[\\]\\);",
    "  async function loadPaymentHold() {\n    setPaymentHoldLoading(true);\n    try {\n      const res = await fetch(\"/api/admin/settings/payment-hold\", { cache: \"no-store\" });\n      const data = (await res.json()) as { minutes?: number };\n      if (typeof data.minutes === \"number\") setPaymentHoldMinutes(data.minutes);\n    } finally {\n      setPaymentHoldLoading(false);\n    }\n  }\n\n  useEffect(() => {\n    loadStatus();\n    loadPaymentHold();\n    if (typeof window !== \"undefined\") {\n      setCallbackUrl(`${window.location.origin}/api/squash/vipps-webhook`);\n    }\n  }, []);",
    "form-load-effect",
    "async function loadPaymentHold() {",
) and ok

ok = apply_regex(
    P_VIPPS_FORM,
    "\\ \\ \\ \\ \\}\\ catch\\ \\{\\\n\\ \\ \\ \\ \\ \\ setActivateMessage\\(\\{\\ ok:\\ false,\\ text:\\ \"Kunne\\ ikke\\ endre\\ akkurat\\ n.*?\\.\"\\ \\}\\);\\\n\\ \\ \\ \\ \\}\\ finally\\ \\{\\\n\\ \\ \\ \\ \\ \\ setActivating\\(false\\);\\\n\\ \\ \\ \\ \\}\\\n\\ \\ \\}\\\n\\\n\\ \\ return\\ \\(",
    "    } catch {\n      setActivateMessage({ ok: false, text: \"Kunne ikke endre akkurat n\u00e5.\" });\n    } finally {\n      setActivating(false);\n    }\n  }\n\n  async function handleSavePaymentHold(e: FormEvent) {\n    e.preventDefault();\n    setSavingPaymentHold(true);\n    setPaymentHoldMessage(null);\n    try {\n      const res = await fetch(\"/api/admin/settings/payment-hold\", {\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" },\n        body: JSON.stringify({ minutes: paymentHoldMinutes }),\n      });\n      const data = (await res.json()) as { error?: string; minutes?: number };\n      if (!res.ok) {\n        setPaymentHoldMessage({ ok: false, text: data.error ?? \"Kunne ikke lagre.\" });\n        return;\n      }\n      if (typeof data.minutes === \"number\") setPaymentHoldMinutes(data.minutes);\n      setPaymentHoldMessage({ ok: true, text: \"Lagret.\" });\n    } catch {\n      setPaymentHoldMessage({ ok: false, text: \"Kunne ikke lagre akkurat n\u00e5.\" });\n    } finally {\n      setSavingPaymentHold(false);\n    }\n  }\n\n  return (",
    "form-save-handler",
    "async function handleSavePaymentHold(e: FormEvent) {",
) and ok

ok = apply_regex(
    P_VIPPS_FORM,
    "\\ \\ \\ \\ \\ \\ \\ \\ \\{activateMessage\\ \\&\\&\\ \\(\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <p\\ className=\\{activateMessage\\.ok\\ \\?\\ styles\\.bookingMeta\\ :\\ styles\\.error\\}\\ style=\\{\\{\\ marginTop:\\ 10\\ \\}\\}>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\{activateMessage\\.text\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ </p>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\)\\}\\\n\\ \\ \\ \\ \\ \\ </div>\\\n\\ \\ \\ \\ \\ \\ </div>\\\n\\ \\ \\ \\ \\ \\ </div>\\\n\\ \\ \\ \\ \\ \\ \\ \\ </div>\\\n\\ \\ \\ \\ \\ \\ </main>",
    "        {activateMessage && (\n          <p className={activateMessage.ok ? styles.bookingMeta : styles.error} style={{ marginTop: 10 }}>\n            {activateMessage.text}\n          </p>\n        )}\n      </div>\n      </div>\n      </div>\n\n      <div className={styles.card}>\n        <h2 style={{ marginTop: 0, fontSize: \"1.1rem\" }}>Betalingsforesp\u00f8rsel fra admin</h2>\n        <p className={styles.bookingMeta}>\n          N\u00e5r admin booker en tid i Bookinger-fanen og velger &quot;Be om betaling (Vipps)&quot; i stedet for \u00e5 booke\n          direkte, sendes det en betalingsforesp\u00f8rsel rett til kundens Vipps-app, og bookingen blir f\u00f8rst bindende\n          n\u00e5r kunden har betalt. Betaler ikke kunden i tide, frigj\u00f8res tiden automatisk igjen - her styrer du hvor\n          lenge den holdes av f\u00f8rst.\n        </p>\n        <form onSubmit={handleSavePaymentHold} className={styles.form}>\n          <div className={styles.formRow}>\n            <label htmlFor=\"payment-hold-minutes\">Minutter tiden holdes av</label>\n            <input\n              id=\"payment-hold-minutes\"\n              type=\"number\"\n              min={1}\n              max={10080}\n              value={paymentHoldMinutes}\n              onChange={(e) => setPaymentHoldMinutes(Math.max(1, Math.min(10080, Number(e.target.value) || 1)))}\n              disabled={paymentHoldLoading}\n            />\n          </div>\n          {paymentHoldMessage && (\n            <p className={paymentHoldMessage.ok ? styles.bookingMeta : styles.error}>{paymentHoldMessage.text}</p>\n          )}\n          <button type=\"submit\" className={styles.submitButton} disabled={savingPaymentHold || paymentHoldLoading}>\n            {savingPaymentHold ? \"Lagrer \u2026\" : \"Lagre\"}\n          </button>\n        </form>\n      </div>\n        </div>\n      </main>",
    "form-jsx-card",
    "Betalingsforesp\u00f8rsel fra admin",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ const\\ \\[manualRecurring,\\ setManualRecurring\\]\\ =\\ useState\\(false\\);\\\n\\ \\ const\\ \\[manualWeeks,\\ setManualWeeks\\]\\ =\\ useState\\(4\\);\\\n\\ \\ const\\ \\[manualSubmitting,\\ setManualSubmitting\\]\\ =\\ useState\\(false\\);",
    "  const [manualRecurring, setManualRecurring] = useState(false);\n  const [manualWeeks, setManualWeeks] = useState(4);\n  // Betalingsm\u00e5te for en NY manuell booking (kun relevant i \"create\"-modus) \u2013\n  // se durationToggle-aktige knappene i modalen under, og\n  // app/api/admin/bookings/manual/route.ts for selve logikken bak de to\n  // modiene.\n  const [manualRequestPayment, setManualRequestPayment] = useState(false);\n  const [manualSubmitting, setManualSubmitting] = useState(false);",
    "bi-state",
    "const [manualRequestPayment, setManualRequestPayment] = useState(false);",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ \\ \\ setManualRecurring\\(false\\);\\\n\\ \\ \\ \\ setManualWeeks\\(4\\);\\\n\\ \\ \\ \\ setManualError\\(null\\);\\\n\\ \\ \\}",
    "    setManualRecurring(false);\n    setManualWeeks(4);\n    setManualRequestPayment(false);\n    setManualError(null);\n  }",
    "bi-open-create-reset",
    "setManualRequestPayment(false);\n    setManualError(null);",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ body:\\ JSON\\.stringify\\(\\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ date:\\ modal\\.date,\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ time:\\ manualTime,\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ name:\\ manualName,\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ phone:\\ manualPhone,\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ durationMinutes:\\ manualDurationMinutes,\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ weeks:\\ manualRecurring\\ \\?\\ manualWeeks\\ :\\ 1,\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\}\\),\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\}\\);\\\n\\ \\ \\ \\ \\ \\ \\ \\ const\\ data\\ =\\ \\(await\\ res\\.json\\(\\)\\.catch\\(\\(\\)\\ =>\\ \\(\\{\\}\\)\\)\\)\\ as\\ \\{\\ error\\?:\\ string\\ \\};\\\n\\ \\ \\ \\ \\ \\ \\ \\ if\\ \\(!res\\.ok\\)\\ \\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ setManualError\\(data\\.error\\ \\?\\?\\ \"Kunne\\ ikke\\ booke\\ tiden\\.\"\\);\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ return;\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\}\\\n\\ \\ \\ \\ \\ \\ \\}\\ else\\ \\{",
    "          body: JSON.stringify({\n            date: modal.date,\n            time: manualTime,\n            name: manualName,\n            phone: manualPhone,\n            durationMinutes: manualDurationMinutes,\n            weeks: manualRecurring ? manualWeeks : 1,\n            requestPayment: manualRequestPayment,\n          }),\n        });\n        const data = (await res.json().catch(() => ({}))) as { error?: string; redirectUrl?: string };\n        if (!res.ok) {\n          setManualError(\n            data.error ?? (manualRequestPayment ? \"Kunne ikke sende betalingsforesp\u00f8rsel.\" : \"Kunne ikke booke tiden.\")\n          );\n          return;\n        }\n        // Kun satt i mock/testmodus (se app/api/admin/bookings/manual/route.ts)\n        // \u2013 en lenke dere selv kan \u00e5pne for \u00e5 simulere kundens godkjenning,\n        // siden det ikke finnes noen ekte telefon \u00e5 sende et push-varsel til\n        // i testmodus.\n        if (manualRequestPayment && data.redirectUrl) {\n          window.alert(\n            `Betalingsforesp\u00f8rsel sendt. Testlenke (kun i simulert/test-modus \u2013 ignorer i ekte Vipps-modus): ${data.redirectUrl}`\n          );\n        }\n      } else {",
    "bi-submit-body-and-alert",
    "requestPayment: manualRequestPayment,",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ \\ \\ \\ \\ setManualError\\(\\\n\\ \\ \\ \\ \\ \\ \\ \\ modal\\.mode\\ ===\\ \"create\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\?\\ \"Kunne\\ ikke\\ booke\\ tiden\\ akkurat\\ n.*?\\.\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ :\\ modal\\.status\\ ===\\ \"cancelled\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\?\\ \"Kunne\\ ikke\\ aktivere\\ bookingen\\ p.*?\\ nytt\\ akkurat\\ n.*?\\.\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ :\\ \"Kunne\\ ikke\\ lagre\\ endringen\\ akkurat\\ n.*?\\.\"\\\n\\ \\ \\ \\ \\ \\ \\);",
    "      setManualError(\n        modal.mode === \"create\"\n          ? manualRequestPayment\n            ? \"Kunne ikke sende betalingsforesp\u00f8rsel akkurat n\u00e5.\"\n            : \"Kunne ikke booke tiden akkurat n\u00e5.\"\n          : modal.status === \"cancelled\"\n            ? \"Kunne ikke aktivere bookingen p\u00e5 nytt akkurat n\u00e5.\"\n            : \"Kunne ikke lagre endringen akkurat n\u00e5.\"\n      );",
    "bi-catch-error",
    "\"Kunne ikke sende betalingsforesp\u00f8rsel akkurat n\u00e5.\"",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ const\\ submitDisabled\\ =\\ manualSubmitting\\ \\|\\|\\ \\(needsSlotGrid\\ \\&\\&\\ !manualTime\\);",
    "  const submitDisabled =\n    manualSubmitting ||\n    (needsSlotGrid && !manualTime) ||\n    (modal !== null && modal.mode === \"create\" && manualRequestPayment && !manualPhone.trim());",
    "bi-submit-disabled",
    "manualRequestPayment && !manualPhone.trim());",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\{modal\\.mode\\ ===\\ \"create\"\\ \\?\\ \"Book\\ uten\\ betaling\"\\ :\\ modal\\.status\\ ===\\ \"cancelled\"\\ \\?\\ \"Aktiver\\ booking\\ p.*?\\ nytt\"\\ :\\ \"Rediger\\ booking\"\\}\\ .*?\\{\"\\ \"\\}",
    "              {modal.mode === \"create\"\n                ? manualRequestPayment\n                  ? \"Be om betaling (Vipps)\"\n                  : \"Book uten betaling\"\n                : modal.status === \"cancelled\"\n                  ? \"Aktiver booking p\u00e5 nytt\"\n                  : \"Rediger booking\"}{\" \"}\n              \u2013{\" \"}",
    "bi-modal-title",
    "\"Be om betaling (Vipps)\"\n                  : \"Book uten betaling\"",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <p\\ className=\\{styles\\.bookingMeta\\}>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\{modal\\.mode\\ ===\\ \"create\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\?\\ \"Bookingen\\ er\\ bekreftet\\ med\\ en\\ gang,\\ uten\\ Vipps\\.\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ :\\ modal\\.status\\ ===\\ \"cancelled\"",
    "            <p className={styles.bookingMeta}>\n              {modal.mode === \"create\"\n                ? manualRequestPayment\n                  ? \"Det sendes en betalingsforesp\u00f8rsel til telefonnummeret under via Vipps. Bookingen blir f\u00f8rst bindende n\u00e5r kunden har godkjent/betalt.\"\n                  : \"Bookingen er bekreftet med en gang, uten Vipps.\"\n                : modal.status === \"cancelled\"",
    "bi-modal-description",
    "Det sendes en betalingsforesp\u00f8rsel til telefonnummeret under via Vipps.",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ 1\\ time\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ </button>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ </div>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\)\\}\\\n\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\{modal\\.mode\\ ===\\ \"create\"\\ \\&\\&\\ \\(\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <div\\ style=\\{\\{\\ marginTop:\\ 10\\ \\}\\}>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <label\\ className=\\{styles\\.checkboxOption\\}>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <input\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ type=\"checkbox\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ checked=\\{manualRecurring\\}",
    "                  1 time\n                </button>\n              </div>\n            )}\n\n            {modal.mode === \"create\" && (\n              <div className={styles.durationToggle} style={{ marginTop: 10 }}>\n                <button\n                  type=\"button\"\n                  className={`${styles.durationToggleButton} ${\n                    !manualRequestPayment ? styles.durationToggleButtonActive : \"\"\n                  }`}\n                  onClick={() => setManualRequestPayment(false)}\n                >\n                  Book uten betaling\n                </button>\n                <button\n                  type=\"button\"\n                  className={`${styles.durationToggleButton} ${\n                    manualRequestPayment ? styles.durationToggleButtonActive : \"\"\n                  }`}\n                  onClick={() => setManualRequestPayment(true)}\n                >\n                  Be om betaling (Vipps)\n                </button>\n              </div>\n            )}\n\n            {modal.mode === \"create\" && (\n              <div style={{ marginTop: 10 }}>\n                <label className={styles.checkboxOption}>\n                  <input\n                    type=\"checkbox\"\n                    checked={manualRecurring}",
    "bi-payment-toggle-jsx",
    "onClick={() => setManualRequestPayment(true)}",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <div\\ className=\\{styles\\.formRow\\}>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <label\\ htmlFor=\"manual\\-phone\">Telefon\\ \\(valgfritt\\)</label>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <input\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ id=\"manual\\-phone\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ type=\"tel\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ value=\\{manualPhone\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ onChange=\\{\\(e\\)\\ =>\\ setManualPhone\\(e\\.target\\.value\\)\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ />\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ </div>",
    "              <div className={styles.formRow}>\n                <label htmlFor=\"manual-phone\">\n                  {modal.mode === \"create\" && manualRequestPayment\n                    ? \"Telefon (p\u00e5krevd for betalingsforesp\u00f8rsel)\"\n                    : \"Telefon (valgfritt)\"}\n                </label>\n                <input\n                  id=\"manual-phone\"\n                  type=\"tel\"\n                  required={modal.mode === \"create\" && manualRequestPayment}\n                  value={manualPhone}\n                  onChange={(e) => setManualPhone(e.target.value)}\n                />\n              </div>",
    "bi-phone-field",
    "required={modal.mode === \"create\" && manualRequestPayment}",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ :\\ modal\\.mode\\ ===\\ \"create\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\?\\ manualRecurring\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\?\\ \"Book\\ rekken\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ :\\ \"Book\\ tiden\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ :\\ modal\\.status\\ ===\\ \"cancelled\"",
    "                    : modal.mode === \"create\"\n                      ? manualRequestPayment\n                        ? manualRecurring\n                          ? \"Send betalingsforesp\u00f8rsel (rekke)\"\n                          : \"Send betalingsforesp\u00f8rsel\"\n                        : manualRecurring\n                          ? \"Book rekken\"\n                          : \"Book tiden\"\n                      : modal.status === \"cancelled\"",
    "bi-submit-button-label",
    "\"Send betalingsforesp\u00f8rsel\"",
) and ok

ok = write_full_file(
    P_ADMIN_PAYMENT_HOLD,
    "import \"server-only\";\nimport { getRepository } from \"@/lib/db\";\n\n/**\n * Hvor mange minutter en booking admin har SENDT BETALINGSFORESP\u00d8RSEL for\n * (se app/api/admin/bookings/manual/route.ts, \"Be om betaling via Vipps\")\n * holdes av f\u00f8r den automatisk frigj\u00f8res igjen hvis kunden ikke har betalt.\n * Helt uavhengig av HOLD_MINUTES i lib/config.ts (som styrer den vanlige,\n * kundestyrte selvbetjenings-bookingen p\u00e5 bookingsiden - der forventes\n * betaling i l\u00f8pet av noen minutter, mens en betalingsforesp\u00f8rsel fra admin\n * ofte sendes i forkant, og kunden betaler kanskje ikke med en gang).\n *\n * Satt av klubben i Innstillinger \u2192 Vipps (se\n * app/admin/settings/VippsSettingsForm.tsx). Lagret i samme generiske\n * n\u00f8kkel/verdi-tabell som resten av innstillingene (se\n * lib/settings/recurringLimit.ts for samme m\u00f8nster). `null`/ingen verdi\n * lagret enn\u00e5 betyr DEFAULT_ADMIN_PAYMENT_HOLD_MINUTES under.\n */\nconst KEY = \"adminPaymentRequestHoldMinutes\";\nexport const DEFAULT_ADMIN_PAYMENT_HOLD_MINUTES = 10;\n/** \u00d8vre grense - rent for \u00e5 unng\u00e5 \u00e5 l\u00e5se banen i ukesvis ved en tastefeil. */\nconst MAX_MINUTES = 10_080; // 7 dager\n\nexport async function getAdminPaymentRequestHoldMinutes(): Promise<number> {\n  const repo = await getRepository();\n  const raw = await repo.getSetting(KEY);\n  if (!raw) return DEFAULT_ADMIN_PAYMENT_HOLD_MINUTES;\n  const n = Number(raw);\n  return Number.isInteger(n) && n >= 1 && n <= MAX_MINUTES ? n : DEFAULT_ADMIN_PAYMENT_HOLD_MINUTES;\n}\n\nexport async function saveAdminPaymentRequestHoldMinutes(minutes: number): Promise<number> {\n  const repo = await getRepository();\n  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {\n    throw new Error(`Ugyldig antall minutter (m\u00e5 v\u00e6re et helt tall mellom 1 og ${MAX_MINUTES}).`);\n  }\n  await repo.setSetting(KEY, String(minutes));\n  return minutes;\n}\n",
    "admin-payment-hold-settings-file",
    "adminPaymentRequestHoldMinutes",
) and ok

ok = write_full_file(
    P_PAYMENT_HOLD_ROUTE,
    "import { NextRequest, NextResponse } from \"next/server\";\nimport { getAdminPaymentRequestHoldMinutes, saveAdminPaymentRequestHoldMinutes } from \"@/lib/settings/adminPaymentHold\";\n\nexport const dynamic = \"force-dynamic\";\n\n/**\n * GET  /api/admin/settings/payment-hold - hent antall minutter en\n *      admin-sendt betalingsforesp\u00f8rsel holdes av f\u00f8r den frigj\u00f8res igjen.\n * POST /api/admin/settings/payment-hold - sett et nytt antall minutter.\n *\n * Beskyttet av middleware.ts som resten av /api/admin/** - krever gyldig\n * admin-sesjon. Se lib/settings/adminPaymentHold.ts for selve lagringen.\n */\nexport async function GET() {\n  try {\n    const minutes = await getAdminPaymentRequestHoldMinutes();\n    return NextResponse.json({ minutes });\n  } catch (err) {\n    return NextResponse.json(\n      { error: err instanceof Error ? err.message : \"Kunne ikke hente innstillingen.\" },\n      { status: 500 }\n    );\n  }\n}\n\ninterface SaveBody {\n  minutes?: number;\n}\n\nexport async function POST(request: NextRequest) {\n  let body: SaveBody;\n  try {\n    body = (await request.json()) as SaveBody;\n  } catch {\n    return NextResponse.json({ error: \"Ugyldig foresp\u00f8rsel.\" }, { status: 400 });\n  }\n\n  try {\n    const minutes = await saveAdminPaymentRequestHoldMinutes(Number(body.minutes));\n    return NextResponse.json({ ok: true, minutes });\n  } catch (err) {\n    return NextResponse.json({ error: err instanceof Error ? err.message : \"Kunne ikke lagre.\" }, { status: 400 });\n  }\n}\n",
    "payment-hold-api-route",
    "getAdminPaymentRequestHoldMinutes",
) and ok

ok = write_full_file(
    P_MANUAL,
    "import { randomUUID } from \"node:crypto\";\nimport { NextRequest, NextResponse } from \"next/server\";\nimport { getRepository } from \"@/lib/db\";\nimport { generateWeeklyDates, isValidBookingDateString, isWithinOpeningHours, occurrenceRange } from \"@/lib/slots\";\nimport { normalizeNorwegianMobile } from \"@/lib/phone\";\nimport {\n  COURT_ID,\n  durationMinutesToSlots,\n  isBookableDurationMinutes,\n  MAX_RECURRING_WEEKS,\n  VENUE_NAME,\n  type BookingDurationMinutes,\n} from \"@/lib/config\";\nimport { formatDurationMinutes } from \"@/lib/formatting\";\nimport { getPaymentProviderImpl } from \"@/lib/payments\";\nimport { effectiveHoursForDate, getHoursContext } from \"@/lib/settings/openingHours\";\nimport { getAdminPaymentRequestHoldMinutes } from \"@/lib/settings/adminPaymentHold\";\nimport { getPricingSettings, priceForDuration } from \"@/lib/settings/pricing\";\n\nexport const dynamic = \"force-dynamic\";\n\ninterface ManualBookingBody {\n  date?: string;\n  time?: string;\n  name?: string;\n  phone?: string;\n  /** 30 eller 60 (minutter) \u2013 utelatt betyr 60, den gamle, faste varigheten. */\n  durationMinutes?: number;\n  /** Antall uker i en gjentakende rekke (samme ukedag/klokkeslett hver uke \u2013 \"date\" er F\u00d8RSTE forekomst). Utelatt eller 1 betyr en vanlig enkeltbooking. */\n  weeks?: number;\n  /**\n   * true = ikke book bindende med en gang \u2013 send i stedet en Vipps-\n   * betalingsforesp\u00f8rsel (\"PUSH_MESSAGE\") til telefonnummeret, og bookingen\n   * blir f\u00f8rst bindende n\u00e5r kunden har godkjent/betalt (se egen gren\n   * nederst). Krever at \"phone\" er et gyldig norsk mobilnummer \u2013 ellers er\n   * telefon valgfritt for admin.\n   */\n  requestPayment?: boolean;\n}\n\n/**\n * POST /api/admin/bookings/manual\n * Body: { date, time, name, phone?, durationMinutes?, weeks?, requestPayment? }\n *\n * To modi:\n * - requestPayment utelatt/false (standard): admin booker bindende med en\n *   gang, ingen betaling involvert \u2013 som f\u00f8r.\n * - requestPayment: true: oppretter i stedet en \"pending\" booking (akkurat\n *   som den offentlige bookingsiden) og sender en ekte Vipps-betalings-\n *   foresp\u00f8rsel (\"PUSH_MESSAGE\", se lib/payments/vipps.ts) rett til kundens\n *   telefon \u2013 ingen nettleser-omdirigering involvert, siden det er ADMIN,\n *   ikke kunden selv, som sitter i denne nettleseren akkurat n\u00e5. Bookingen\n *   blir f\u00f8rst bindende (status \"confirmed\") n\u00e5r kunden godkjenner i\n *   Vipps-appen \u2013 helt samme webhook/avstemmingslogikk som kundens egen\n *   bookingsflyt (se app/api/squash/vipps-webhook/route.ts), siden alt her\n *   er identifisert med samme slags gruppe-id som referanse.\n *\n * Varigheten er 30 minutter eller 1 time (se BOOKABLE_DURATIONS_MINUTES i\n * lib/config.ts) \u2013 1 time er fortsatt forh\u00e5ndsvalgt som standard.\n */\nexport async function POST(request: NextRequest) {\n  let body: ManualBookingBody;\n  try {\n    body = (await request.json()) as ManualBookingBody;\n  } catch {\n    return NextResponse.json({ error: \"Ugyldig foresp\u00f8rsel.\" }, { status: 400 });\n  }\n\n  const { date, time } = body;\n  const name = body.name?.trim() ?? \"\";\n  const rawPhone = body.phone?.trim() ?? \"\";\n  const requestPayment = body.requestPayment === true;\n\n  if (!date || !isValidBookingDateString(date)) {\n    return NextResponse.json({ error: \"Ugyldig dato.\" }, { status: 400 });\n  }\n  if (!time || !/^\\d{2}:\\d{2}$/.test(time)) {\n    return NextResponse.json({ error: \"Ugyldig klokkeslett.\" }, { status: 400 });\n  }\n\n  const weeks = Number(body.weeks ?? 1);\n  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_RECURRING_WEEKS) {\n    return NextResponse.json({ error: `Antall uker m\u00e5 v\u00e6re mellom 1 og ${MAX_RECURRING_WEEKS}.` }, { status: 400 });\n  }\n\n  const durationMinutes: BookingDurationMinutes = isBookableDurationMinutes(body.durationMinutes)\n    ? body.durationMinutes\n    : 60;\n\n  if (name.length < 2 || name.length > 100) {\n    return NextResponse.json({ error: \"Navn m\u00e5 v\u00e6re mellom 2 og 100 tegn.\" }, { status: 400 });\n  }\n\n  // Telefon er valgfritt for admin N\u00c5R bookingen gj\u00f8res bindende med en\n  // gang (i motsetning til den offentlige bookingsiden) \u2013 men hvis noe er\n  // skrevet inn, m\u00e5 det se ut som et ekte norsk mobilnummer, slik at det\n  // stemmer overens med leaderboard/statistikk. Sender admin i stedet en\n  // betalingsforesp\u00f8rsel, er telefon P\u00c5KREVD (se sjekken under) \u2013 det er jo\n  // dit foresp\u00f8rselen sendes.\n  let phone = \"\";\n  if (rawPhone) {\n    const normalized = normalizeNorwegianMobile(rawPhone);\n    if (!normalized) {\n      return NextResponse.json(\n        { error: \"Ugyldig mobilnummer. La feltet st\u00e5 tomt, eller bruk et norsk mobilnummer.\" },\n        { status: 400 }\n      );\n    }\n    phone = normalized;\n  }\n\n  if (requestPayment && !phone) {\n    return NextResponse.json(\n      { error: \"Mobilnummer er p\u00e5krevd for \u00e5 sende en betalingsforesp\u00f8rsel.\" },\n      { status: 400 }\n    );\n  }\n\n  const dates = generateWeeklyDates(date, weeks);\n  const durationSlots = durationMinutesToSlots(durationMinutes);\n  const occurrences = dates.map((d) => occurrenceRange(d, time, durationSlots));\n  if (occurrences.some((o) => !o)) {\n    return NextResponse.json({ error: \"Klokkeslettet finnes ikke i timeplanen.\" }, { status: 400 });\n  }\n  const validOccurrences = occurrences as Array<{ startTime: Date; endTime: Date }>;\n\n  // Hver dato i rekken kan ha sine EGNE \u00e5pningstider (ukedagens standard,\n  // eller en \"ferie/annerledesdag\"-unntak) \u2013 sl\u00e5 opp alt i \u00e9tt oppslag og\n  // sjekk hver forekomst mot sin egen dags effektive \u00e5pningstid, i stedet\n  // for \u00e9n global \u00e5pningstid for alle datoene. Samme m\u00f8nster som\n  // app/api/squash/bookings/route.ts.\n  const hoursContext = await getHoursContext();\n  const outOfHoursIndex = validOccurrences.findIndex(\n    (o, i) => !isWithinOpeningHours(o.startTime, o.endTime, effectiveHoursForDate(dates[i], hoursContext))\n  );\n  if (outOfHoursIndex !== -1) {\n    return NextResponse.json(\n      {\n        error:\n          weeks > 1\n            ? `${dates[outOfHoursIndex]} er stengt eller har andre \u00e5pningstider \u2013 juster klokkeslett eller antall uker.`\n            : \"Denne dagen er stengt, eller klokkeslettet passer ikke innenfor \u00e5pningstidene.\",\n      },\n      { status: 400 }\n    );\n  }\n\n  const pricing = await getPricingSettings();\n  const totalAmountOre = priceForDuration(pricing, durationMinutes) * validOccurrences.length;\n  const repo = await getRepository();\n\n  if (!requestPayment) {\n    const result = await repo.createAdminBooking({\n      customerName: name,\n      customerPhone: phone,\n      totalAmountOre,\n      ranges: validOccurrences.map((o) => ({ startTime: o.startTime.toISOString(), endTime: o.endTime.toISOString() })),\n    });\n\n    if (!result.ok) {\n      return NextResponse.json(\n        {\n          error:\n            weeks > 1\n              ? \"\u00c9n eller flere av datoene i rekken er allerede opptatt. Juster tidspunkt eller antall uker.\"\n              : \"Den tiden er allerede opptatt. Velg et annet klokkeslett.\",\n          conflicts: result.conflicts,\n        },\n        { status: 409 }\n      );\n    }\n\n    return NextResponse.json({ ok: true, id: result.group.id });\n  }\n\n  // --- requestPayment: true \u2013 samme to-trinns m\u00f8nster som den offentlige\n  // bookingsiden (pending-gruppe + hold, deretter start betaling), men med\n  // userFlow \"PUSH_MESSAGE\" (se lib/payments/vipps.ts) i stedet for\n  // \"WEB_REDIRECT\", siden det er ADMIN som sitter i denne nettleseren, ikke\n  // kunden \u2013 se app/api/squash/bookings/route.ts for det nesten identiske\n  // kunde-m\u00f8nsteret dette er bygget etter.\n  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;\n  if (!siteUrl) {\n    console.error(\"[admin/bookings/manual] NEXT_PUBLIC_SITE_URL mangler.\");\n    return NextResponse.json({ error: \"Serverkonfigurasjonsfeil.\" }, { status: 500 });\n  }\n\n  const bookingId = randomUUID();\n  const holdMinutes = await getAdminPaymentRequestHoldMinutes();\n  const holdExpiresAt = new Date(Date.now() + holdMinutes * 60_000);\n\n  const createResult = await repo.createGroupWithSlots({\n    id: bookingId,\n    kind: weeks > 1 ? \"recurring\" : \"single\",\n    source: \"admin\",\n    customerName: name,\n    customerPhone: phone,\n    totalAmountOre,\n    holdExpiresAt: holdExpiresAt.toISOString(),\n    slots: validOccurrences.map((o) => ({\n      courtId: COURT_ID,\n      startTime: o.startTime.toISOString(),\n      endTime: o.endTime.toISOString(),\n    })),\n  });\n\n  if (!createResult.ok) {\n    return NextResponse.json(\n      {\n        error:\n          weeks > 1\n            ? \"\u00c9n eller flere av datoene i rekken er allerede opptatt. Juster tidspunkt eller antall uker.\"\n            : \"Den tiden er allerede opptatt. Velg et annet klokkeslett.\",\n        conflicts: createResult.conflicts,\n      },\n      { status: 409 }\n    );\n  }\n\n  const description =\n    weeks > 1\n      ? `Squash ${time} hver uke i ${validOccurrences.length} uker fra ${date} (${formatDurationMinutes(durationMinutes)}) \u2013 ${VENUE_NAME}`\n      : `Squash ${time}, ${date} (${formatDurationMinutes(durationMinutes)}) \u2013 ${VENUE_NAME}`;\n\n  try {\n    const provider = await getPaymentProviderImpl();\n    const payment = await provider.createPayment({\n      reference: bookingId,\n      amountOre: totalAmountOre,\n      phoneNumber: phone,\n      description,\n      returnUrl: `${siteUrl}/confirmation?ref=${bookingId}`,\n      userFlow: \"PUSH_MESSAGE\",\n    });\n\n    return NextResponse.json({\n      ok: true,\n      id: bookingId,\n      pending: true,\n      redirectUrl: payment.redirectUrl,\n    });\n  } catch (err) {\n    // Klarte ikke \u00e5 sende betalingsforesp\u00f8rselen \u2013 rull tilbake holdet med\n    // en gang, slik at tiden(e) blir ledig(e) igjen.\n    await repo.cancelGroupAsAdmin(bookingId);\n    console.error(\"[admin/bookings/manual] feil ved oppstart av betalingsforesp\u00f8rsel:\", err);\n    return NextResponse.json(\n      { error: \"Kunne ikke sende betalingsforesp\u00f8rsel akkurat n\u00e5. Pr\u00f8v igjen.\" },\n      { status: 502 }\n    );\n  }\n}\n",
    "manual-route-full-file",
    "requestPayment?: boolean",
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
