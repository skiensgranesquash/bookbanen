import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(".").resolve()


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


def write_new_file(rel_path, content, label):
    path = ROOT / rel_path
    if path.exists():
        print(f"[already done] {label} ({rel_path} already exists)")
        return True
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"[OK] {label} (created {rel_path})")
    return True


ok = True

# ---- Nye filer ----

ok = write_new_file(
    "lib/settings/pageContent.ts",
    "import \"server-only\";\nimport { getRepository } from \"@/lib/db\";\n\n/**\n * De to korte, redigerbare tekstene p\u00e5 selve bookingsiden (se app/page.tsx):\n * medlemskapsnotisen rett over kalenderen, og bunnteksten nederst. Satt via\n * adminpanelet under \"Utseende\" (se app/admin/branding/BrandingManager.tsx og\n * app/admin/branding/RichTextEditor.tsx), lagret i den samme generiske\n * n\u00f8kkel/verdi-innstillingstabellen som resten av innstillingene (samme\n * m\u00f8nster som lib/settings/branding.ts).\n *\n * Teksten kan inneholde enkel formattering (fet/kursiv/understreket) og\n * lenker \u2013 ALDRI noe annet. Siden dette til slutt rendres rett inn p\u00e5 den\n * offentlige bookingsiden med `dangerouslySetInnerHTML` (se app/page.tsx),\n * saneres HTML-en strengt via `sanitizeRichTextHtml` under \u2013 b\u00e5de n\u00e5r en\n * administrator lagrer den OG p\u00e5 nytt hver gang den leses tilbake, som et\n * ekstra sikkerhetslag i tilfelle noe usanert noensinne skulle havne direkte\n * i databasen (f.eks. ved en fremtidig kodeendring eller et direkte\n * databaseoppslag).\n */\n\nconst MEMBERSHIP_NOTICE_KEY = \"pageContentMembershipNoticeHtml\";\nconst FOOTER_KEY = \"pageContentFooterHtml\";\n\n/** Kun disse taggene overlever saneringen \u2013 ingen andre, og ingen attributter bortsett fra `href` p\u00e5 `<a>` (se sanitizeRichTextHtml). */\nconst ALLOWED_INLINE_TAGS = new Set([\"b\", \"strong\", \"i\", \"em\", \"u\"]);\n\n/** Et grovt tak p\u00e5 lengden \u2013 dette skal v\u00e6re noen setninger, ikke en hel artikkel. */\nconst MAX_HTML_LENGTH = 4000;\n\nfunction escapeAttr(value: string): string {\n  return value.replace(/&/g, \"&amp;\").replace(/\"/g, \"&quot;\").replace(/</g, \"&lt;\").replace(/>/g, \"&gt;\");\n}\n\n/** Kun http(s)- eller mailto-lenker regnes som trygge \u2013 aldri `javascript:`, `data:` eller andre skjema. */\nfunction isSafeHref(href: string): boolean {\n  const trimmed = href.trim();\n  if (/^https?:\\/\\/[^\\s<>\"]+$/i.test(trimmed)) return true;\n  return /^mailto:[^\\s<>\"]+@[^\\s<>\"]+$/i.test(trimmed);\n}\n\n/**\n * Saner rik-tekst-HTML ned til et sv\u00e6rt lite, trygt utvalg: fet/kursiv/\n * understreket tekst og vanlige http(s)/mailto-lenker \u2013 INGENTING annet\n * overlever (ingen script/style/bilder/iframer, ingen andre tagger, ingen\n * attributter bortsett fra en validert `href` p\u00e5 `<a>`, ingen\n * event-handlere). Tolererer ogs\u00e5 ubalansert/rotete HTML uten \u00e5 kaste \u2013\n * tagger som blir st\u00e5ende \u00e5pne lukkes automatisk til slutt, og overfl\u00f8dige\n * lukketagger droppes stille, slik at en innlimt/forhastet tekst aldri kan\n * \"lekke\" formattering utover resten av siden.\n *\n * Brukt B\u00c5DE n\u00e5r en administrator lagrer en tekst (se savePageContent under)\n * OG hver gang den leses tilbake (se getPageContent) \u2013 se filkommentaren\n * \u00f8verst for hvorfor.\n */\nexport function sanitizeRichTextHtml(input: string): string {\n  if (!input) return \"\";\n\n  // Fjern <script>/<style>-blokker (og ALT innhold mellom dem) helt, f\u00f8r noe\n  // annet behandles, slik at innholdet deres aldri \"lekker ut\" som vanlig\n  // tekst lenger ned. Fjern ogs\u00e5 HTML-kommentarer (kan ellers brukes til \u00e5\n  // smugle innhold forbi en naiv tagg-for-tagg-sanering).\n  let working = input.replace(/<(script|style)[^>]*>[\\s\\S]*?<\\/\\1>/gi, \"\");\n  working = working.replace(/<!--[\\s\\S]*?-->/g, \"\");\n\n  const tagPattern = /<\\/?([a-zA-Z][a-zA-Z0-9]*)((?:\\s+[^<>]*)?)\\/?>/g;\n  let output = \"\";\n  let lastIndex = 0;\n  const openStack: string[] = [];\n  let match: RegExpExecArray | null;\n\n  while ((match = tagPattern.exec(working)) !== null) {\n    output += working.slice(lastIndex, match.index);\n    lastIndex = tagPattern.lastIndex;\n\n    const raw = match[0];\n    const tagName = match[1].toLowerCase();\n    const attrText = match[2] ?? \"\";\n    const isClosing = raw.startsWith(\"</\");\n\n    if (tagName === \"br\") {\n      if (!isClosing) output += \"<br>\";\n      continue;\n    }\n\n    if (tagName === \"a\") {\n      if (isClosing) {\n        if (openStack.includes(\"a\")) {\n          while (openStack.length > 0) {\n            const tag = openStack.pop() as string;\n            output += `</${tag}>`;\n            if (tag === \"a\") break;\n          }\n        }\n        continue;\n      }\n      const hrefMatch = /href\\s*=\\s*\"([^\"]*)\"|href\\s*=\\s*'([^']*)'/i.exec(attrText);\n      const hrefRaw = hrefMatch ? hrefMatch[1] ?? hrefMatch[2] ?? \"\" : \"\";\n      // Ingen gyldig href - dropp hele <a>-taggen (teksten inni beholdes som\n      // vanlig, ikke-klikkbar tekst) i stedet for \u00e5 lage en \u00f8delagt lenke.\n      if (!isSafeHref(hrefRaw)) continue;\n      output += `<a href=\"${escapeAttr(hrefRaw.trim())}\" target=\"_blank\" rel=\"noopener noreferrer\">`;\n      openStack.push(\"a\");\n      continue;\n    }\n\n    if (ALLOWED_INLINE_TAGS.has(tagName)) {\n      if (isClosing) {\n        if (openStack.includes(tagName)) {\n          while (openStack.length > 0) {\n            const tag = openStack.pop() as string;\n            output += `</${tag}>`;\n            if (tag === tagName) break;\n          }\n        }\n        continue;\n      }\n      output += `<${tagName}>`;\n      openStack.push(tagName);\n      continue;\n    }\n\n    // Ukjent/ikke tillatt tagg (f.eks. <img>, <div>, <span style=...>) -\n    // dropp selve taggen, men behold teksten inni den (den fjernes ikke).\n  }\n\n  output += working.slice(lastIndex);\n\n  // Lukk eventuelle tagger som ble st\u00e5ende \u00e5pne (f.eks. en <b> uten </b>) -\n  // uten dette kunne ubalansert markup fra editoren i verste fall\n  // fetet/kursivert resten av siden under den.\n  while (openStack.length > 0) {\n    output += `</${openStack.pop()}>`;\n  }\n\n  return output.length > MAX_HTML_LENGTH ? output.slice(0, MAX_HTML_LENGTH) : output;\n}\n\nexport const DEFAULT_MEMBERSHIP_NOTICE_HTML =\n  'For \u00e5 booke bane m\u00e5 du ha tilgang til banen gjennom medlemskap i <a href=\"https://www.skiensgrane.no/squash\" target=\"_blank\" rel=\"noopener noreferrer\">Skiens Grane Squash</a> eller <a href=\"https://www.mova.no/treningssenter/skien/hovedsenter\" target=\"_blank\" rel=\"noopener noreferrer\">Mova Skien</a>. Du bekrefter dette f\u00f8r du g\u00e5r videre til betaling.';\n\nexport const DEFAULT_FOOTER_HTML =\n  '<a href=\"https://www.skiensgrane.no/squash\" target=\"_blank\" rel=\"noopener noreferrer\">Bli medlem av Skiens Grane Squash</a> &middot; <a href=\"https://www.mova.no/treningssenter/skien/hovedsenter\" target=\"_blank\" rel=\"noopener noreferrer\">Mova Skien \u2013 \u00e5pningstider</a>';\n\nexport interface PageContent {\n  membershipNoticeHtml: string;\n  footerHtml: string;\n}\n\nexport async function getPageContent(): Promise<PageContent> {\n  const repo = await getRepository();\n  const [storedNotice, storedFooter] = await Promise.all([\n    repo.getSetting(MEMBERSHIP_NOTICE_KEY),\n    repo.getSetting(FOOTER_KEY),\n  ]);\n  return {\n    membershipNoticeHtml:\n      storedNotice && storedNotice.trim() ? sanitizeRichTextHtml(storedNotice) : DEFAULT_MEMBERSHIP_NOTICE_HTML,\n    footerHtml: storedFooter && storedFooter.trim() ? sanitizeRichTextHtml(storedFooter) : DEFAULT_FOOTER_HTML,\n  };\n}\n\nexport interface SavePageContentInput {\n  /** Utelatt felt endrer ikke den lagrede teksten. `null` tilbakestiller den til standardteksten. */\n  membershipNoticeHtml?: string | null;\n  footerHtml?: string | null;\n}\n\n/** Validerer (lengde) og lagrer \u00e9n eller begge tekstene \u2013 saner alltid HTML-en f\u00f8r den lagres, se sanitizeRichTextHtml over. */\nexport async function savePageContent(input: SavePageContentInput): Promise<PageContent> {\n  const repo = await getRepository();\n\n  if (input.membershipNoticeHtml !== undefined) {\n    await repo.setSetting(\n      MEMBERSHIP_NOTICE_KEY,\n      input.membershipNoticeHtml === null ? \"\" : sanitizeRichTextHtml(input.membershipNoticeHtml)\n    );\n  }\n  if (input.footerHtml !== undefined) {\n    await repo.setSetting(FOOTER_KEY, input.footerHtml === null ? \"\" : sanitizeRichTextHtml(input.footerHtml));\n  }\n\n  return getPageContent();\n}\n",
    "create lib/settings/pageContent.ts",
) and ok

ok = write_new_file(
    "app/api/admin/settings/content/route.ts",
    "import { NextRequest, NextResponse } from \"next/server\";\nimport { getPageContent, savePageContent } from \"@/lib/settings/pageContent\";\n\nexport const dynamic = \"force-dynamic\";\n\n/**\n * GET  /api/admin/settings/content \u2013 hent gjeldende tekster p\u00e5 bookingsiden\n *      (medlemskapsnotisen og bunnteksten), som sanert rik-tekst-HTML (fet/\n *      kursiv/understreket/lenke) \u2013 se lib/settings/pageContent.ts.\n * POST /api/admin/settings/content \u2013 lagre \u00e9n eller begge tekstene. Sett en\n *      verdi til null for \u00e5 tilbakestille akkurat den teksten til standard.\n *\n * Beskyttet av middleware.ts som resten av /api/admin/** \u2013 krever gyldig\n * admin-sesjon, og er (som resten av Utseende-fanen) IKKE i\n * BOOKINGS_ONLY_ALLOWED_API_*, s\u00e5 en begrenset administrator har ikke\n * tilgang til \u00e5 endre disse tekstene.\n */\nexport async function GET() {\n  try {\n    const content = await getPageContent();\n    return NextResponse.json(content);\n  } catch (err) {\n    return NextResponse.json(\n      { error: err instanceof Error ? err.message : \"Kunne ikke hente tekster.\" },\n      { status: 500 }\n    );\n  }\n}\n\ninterface SaveContentBody {\n  membershipNoticeHtml?: string | null;\n  footerHtml?: string | null;\n}\n\nexport async function POST(request: NextRequest) {\n  let body: SaveContentBody;\n  try {\n    body = (await request.json()) as SaveContentBody;\n  } catch {\n    return NextResponse.json({ error: \"Ugyldig foresp\u00f8rsel.\" }, { status: 400 });\n  }\n\n  try {\n    const content = await savePageContent(body);\n    return NextResponse.json({ ok: true, ...content });\n  } catch (err) {\n    return NextResponse.json({ error: err instanceof Error ? err.message : \"Kunne ikke lagre.\" }, { status: 400 });\n  }\n}\n",
    "create app/api/admin/settings/content/route.ts",
) and ok

ok = write_new_file(
    "app/admin/branding/RichTextEditor.tsx",
    "\"use client\";\n\nimport { useEffect, useRef } from \"react\";\nimport styles from \"../admin.module.css\";\n\ninterface RichTextEditorProps {\n  /** Gjeldende lagrede HTML \u2013 kun brukt til \u00e5 sette INNHOLDET n\u00e5r editoren f\u00f8rst vises eller n\u00e5r `resetToken` endres, ellers styrer nettleseren selv redigeringen (en fullt kontrollert contentEditable ville \"hoppe\" mark\u00f8ren ved hvert tastetrykk). */\n  value: string;\n  onChange: (html: string) => void;\n  /** \u00d8kes av parent for \u00e5 tvinge innholdet til \u00e5 bli satt p\u00e5 nytt fra `value` (f.eks. rett etter \"Tilbakestill til standard\"). */\n  resetToken: number;\n  disabled?: boolean;\n}\n\n/**\n * Minimal rik-tekst-editor for de to korte tekstene p\u00e5 bookingsiden\n * (medlemskapsnotisen og bunnteksten, se app/admin/branding/BrandingManager.tsx)\n * \u2013 kun fet/kursiv/understreket/lenke, ikke et fullverdig tekstbehandlings-\n * verkt\u00f8y. Bruker den innebygde `contentEditable` + `document.execCommand`\n * (fortsatt st\u00f8ttet i alle store nettlesere for n\u00f8yaktig disse enkle\n * kommandoene, selv om API-et er merket \"deprecated\" i spesifikasjonen) \u2013 et\n * fullverdig rik-tekst-bibliotek ville v\u00e6rt un\u00f8dvendig tungt for to sm\u00e5\n * tekstbokser brukt av noen f\u00e5 administratorer.\n *\n * Selve HTML-en som til slutt lagres saneres likevel ALLTID p\u00e5 SERVER-siden\n * (se sanitizeRichTextHtml i lib/settings/pageContent.ts) \u2013 denne editoren\n * styrer bare hvordan det ser ut mens man skriver, ikke selve sikkerheten.\n */\nexport default function RichTextEditor({ value, onChange, resetToken, disabled }: RichTextEditorProps) {\n  const ref = useRef<HTMLDivElement | null>(null);\n  const lastResetToken = useRef(resetToken);\n\n  // Sett innholdet \u00c9N gang n\u00e5r editoren f\u00f8rst monteres (fra den lagrede\n  // verdien som allerede er hentet av parent p\u00e5 det tidspunktet).\n  useEffect(() => {\n    if (ref.current) ref.current.innerHTML = value;\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);\n\n  // Sett innholdet p\u00e5 nytt KUN n\u00e5r parent bevisst ber om det (resetToken\n  // endres etter en vellykket \"Tilbakestill til standard\") \u2013 IKKE ved hvert\n  // tastetrykk, siden `value` da allerede kommer fra denne samme editoren.\n  useEffect(() => {\n    if (resetToken !== lastResetToken.current) {\n      if (ref.current) ref.current.innerHTML = value;\n      lastResetToken.current = resetToken;\n    }\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [resetToken]);\n\n  function exec(command: string, arg?: string) {\n    if (disabled) return;\n    ref.current?.focus();\n    document.execCommand(command, false, arg);\n    if (ref.current) onChange(ref.current.innerHTML);\n  }\n\n  function handleLink() {\n    if (disabled) return;\n    const url = window.prompt(\"Lenkeadresse (https://... eller mailto:...)\");\n    if (!url) return;\n    const trimmed = url.trim();\n    const normalized = /^https?:\\/\\//i.test(trimmed) || /^mailto:/i.test(trimmed) ? trimmed : `https://${trimmed}`;\n    exec(\"createLink\", normalized);\n  }\n\n  return (\n    <div className={styles.richTextField}>\n      <div className={styles.richTextToolbar}>\n        <button\n          type=\"button\"\n          className={styles.richTextButton}\n          disabled={disabled}\n          onMouseDown={(e) => e.preventDefault()}\n          onClick={() => exec(\"bold\")}\n          title=\"Fet\"\n        >\n          <strong>F</strong>\n        </button>\n        <button\n          type=\"button\"\n          className={styles.richTextButton}\n          disabled={disabled}\n          onMouseDown={(e) => e.preventDefault()}\n          onClick={() => exec(\"italic\")}\n          title=\"Kursiv\"\n        >\n          <em>K</em>\n        </button>\n        <button\n          type=\"button\"\n          className={styles.richTextButton}\n          disabled={disabled}\n          onMouseDown={(e) => e.preventDefault()}\n          onClick={() => exec(\"underline\")}\n          title=\"Understrek\"\n        >\n          <u>U</u>\n        </button>\n        <button\n          type=\"button\"\n          className={styles.richTextButton}\n          disabled={disabled}\n          onMouseDown={(e) => e.preventDefault()}\n          onClick={handleLink}\n          title=\"Legg til lenke\"\n        >\n          Lenke\n        </button>\n        <button\n          type=\"button\"\n          className={styles.richTextButton}\n          disabled={disabled}\n          onMouseDown={(e) => e.preventDefault()}\n          onClick={() => exec(\"unlink\")}\n          title=\"Fjern lenke\"\n        >\n          Fjern lenke\n        </button>\n      </div>\n      <div\n        ref={ref}\n        className={styles.richTextEditable}\n        contentEditable={!disabled}\n        suppressContentEditableWarning\n        onInput={() => {\n          if (ref.current) onChange(ref.current.innerHTML);\n        }}\n      />\n    </div>\n  );\n}\n",
    "create app/admin/branding/RichTextEditor.tsx",
) and ok

# ---- Endringer i eksisterende filer ----

P_PAGE = ROOT / "app/page.tsx"
P_BRANDING = ROOT / "app/admin/branding/BrandingManager.tsx"
P_ADMINCSS = ROOT / "app/admin/admin.module.css"
P_MANUAL = ROOT / "app/api/admin/bookings/manual/route.ts"
P_BI = ROOT / "app/admin/BookingsInsights.tsx"

ok = apply_regex(
    P_PAGE,
    "import\\ \\{\\ getRecurringCutoffDate,\\ getRecurringMaxWeeks\\ \\}\\ from\\ \"@/lib/settings/recurringLimit\";",
    "import { getRecurringCutoffDate, getRecurringMaxWeeks } from \"@/lib/settings/recurringLimit\";\nimport { getPageContent } from \"@/lib/settings/pageContent\";",
    "page/import-pageContent",
    "from \"@/lib/settings/pageContent\";",
) and ok

ok = apply_regex(
    P_PAGE,
    "\\ \\ const\\ \\[branding,\\ recurringCutoffDate,\\ recurringMaxWeeks,\\ pricing\\]\\ =\\ await\\ Promise\\.all\\(\\[\\\n\\ \\ \\ \\ getBranding\\(\\),\\\n\\ \\ \\ \\ getRecurringCutoffDate\\(\\),\\\n\\ \\ \\ \\ getRecurringMaxWeeks\\(\\),\\\n\\ \\ \\ \\ getPricingSettings\\(\\),\\\n\\ \\ \\]\\);",
    "  const [branding, recurringCutoffDate, recurringMaxWeeks, pricing, pageContent] = await Promise.all([\n    getBranding(),\n    getRecurringCutoffDate(),\n    getRecurringMaxWeeks(),\n    getPricingSettings(),\n    getPageContent(),\n  ]);",
    "page/promise-all-pageContent",
    "recurringMaxWeeks, pricing, pageContent] = await Promise.all",
) and ok

ok = apply_regex(
    P_PAGE,
    "\\ \\ \\ \\ \\ \\ <p\\ className=\\{styles\\.membershipNotice\\}>\\\n\\ \\ \\ \\ \\ \\ \\ \\ For\\ .*?\\ booke\\ bane\\ m.*?\\ du\\ ha\\ tilgang\\ til\\ banen\\ gjennom\\ medlemskap\\ i\\{\"\\ \"\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ <a\\ href=\"https://www\\.skiensgrane\\.no/squash\"\\ target=\"_blank\"\\ rel=\"noopener\\ noreferrer\">\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ Skiens\\ Grane\\ Squash\\\n\\ \\ \\ \\ \\ \\ \\ \\ </a>\\{\"\\ \"\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ eller\\{\"\\ \"\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ <a\\ href=\"https://www\\.mova\\.no/treningssenter/skien/hovedsenter\"\\ target=\"_blank\"\\ rel=\"noopener\\ noreferrer\">\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ Mova\\ Skien\\\n\\ \\ \\ \\ \\ \\ \\ \\ </a>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\.\\ Du\\ bekrefter\\ dette\\ f.*?r\\ du\\ g.*?r\\ videre\\ til\\ betaling\\.\\\n\\ \\ \\ \\ \\ \\ </p>",
    "      <p className={styles.membershipNotice} dangerouslySetInnerHTML={{ __html: pageContent.membershipNoticeHtml }} />",
    "page/membership-notice",
    "pageContent.membershipNoticeHtml }} />",
) and ok

ok = apply_regex(
    P_PAGE,
    "\\ \\ \\ \\ \\ \\ <footer\\\n\\ \\ \\ \\ \\ \\ \\ \\ style=\\{\\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ marginTop:\\ \"32px\",\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ paddingTop:\\ \"16px\",\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ borderTop:\\ \"1px\\ solid\\ \\#e5e7eb\",\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ fontSize:\\ \"0\\.85rem\",\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ color:\\ \"\\#6b7280\",\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ textAlign:\\ \"center\",\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\}\\}\\\n\\ \\ \\ \\ \\ \\ >\\\n\\ \\ \\ \\ \\ \\ \\ \\ <a\\ href=\"https://www\\.skiensgrane\\.no/squash\"\\ target=\"_blank\"\\ rel=\"noopener\\ noreferrer\"\\ style=\\{\\{\\ color:\\ \"\\#0046b3\"\\ \\}\\}>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ Bli\\ medlem\\ av\\ Skiens\\ Grane\\ Squash\\\n\\ \\ \\ \\ \\ \\ \\ \\ </a>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\{\"\\ \"\\}\\&middot;\\{\"\\ \"\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ <a\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ href=\"https://www\\.mova\\.no/treningssenter/skien/hovedsenter\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ target=\"_blank\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ rel=\"noopener\\ noreferrer\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ style=\\{\\{\\ color:\\ \"\\#0046b3\"\\ \\}\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ >\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ Mova\\ Skien\\ .*?\\ .*?pningstider\\\n\\ \\ \\ \\ \\ \\ \\ \\ </a>\\\n\\ \\ \\ \\ \\ \\ </footer>",
    "      <footer\n        style={{\n          marginTop: \"32px\",\n          paddingTop: \"16px\",\n          borderTop: \"1px solid #e5e7eb\",\n          fontSize: \"0.85rem\",\n          color: \"#6b7280\",\n          textAlign: \"center\",\n        }}\n        dangerouslySetInnerHTML={{ __html: pageContent.footerHtml }}\n      />",
    "page/footer",
    "dangerouslySetInnerHTML={{ __html: pageContent.footerHtml }}",
) and ok

ok = apply_regex(
    P_BRANDING,
    "import\\ \\{\\ useEffect,\\ useRef,\\ useState,\\ type\\ FormEvent\\ \\}\\ from\\ \"react\";\\\nimport\\ styles\\ from\\ \"\\.\\./admin\\.module\\.css\";\\\nimport\\ AdminNav\\ from\\ \"\\.\\./AdminNav\";",
    "import { useEffect, useRef, useState, type FormEvent } from \"react\";\nimport styles from \"../admin.module.css\";\nimport AdminNav from \"../AdminNav\";\nimport RichTextEditor from \"./RichTextEditor\";",
    "branding/import-RichTextEditor",
    "import RichTextEditor from \"./RichTextEditor\";",
) and ok

ok = apply_regex(
    P_BRANDING,
    "\\ \\ const\\ \\[saving,\\ setSaving\\]\\ =\\ useState\\(false\\);\\\n\\ \\ const\\ \\[saveMessage,\\ setSaveMessage\\]\\ =\\ useState<\\{\\ ok:\\ boolean;\\ text:\\ string\\ \\}\\ \\|\\ null>\\(null\\);\\\n\\ \\ const\\ fileInputRef\\ =\\ useRef<HTMLInputElement\\ \\|\\ null>\\(null\\);\\\n\\\n\\ \\ useEffect\\(\\(\\)\\ =>\\ \\{\\\n\\ \\ \\ \\ fetch\\(\"/api/admin/settings/branding\",\\ \\{\\ cache:\\ \"no\\-store\"\\ \\}\\)",
    "  const [saving, setSaving] = useState(false);\n  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);\n  const fileInputRef = useRef<HTMLInputElement | null>(null);\n\n  // --- Tekster p\u00e5 bookingsiden (medlemskapsnotis + bunntekst) ---\n  const [membershipNoticeHtml, setMembershipNoticeHtml] = useState(\"\");\n  const [footerHtml, setFooterHtml] = useState(\"\");\n  const [contentLoading, setContentLoading] = useState(true);\n  const [contentLoadError, setContentLoadError] = useState<string | null>(null);\n  const [savingNotice, setSavingNotice] = useState(false);\n  const [savingFooter, setSavingFooter] = useState(false);\n  const [noticeMessage, setNoticeMessage] = useState<{ ok: boolean; text: string } | null>(null);\n  const [footerMessage, setFooterMessage] = useState<{ ok: boolean; text: string } | null>(null);\n  // \u00d8kes etter en vellykket \"Tilbakestill til standard\" for \u00e5 tvinge\n  // RichTextEditor til \u00e5 sette innholdet sitt p\u00e5 nytt (se RichTextEditor.tsx).\n  const [noticeResetToken, setNoticeResetToken] = useState(0);\n  const [footerResetToken, setFooterResetToken] = useState(0);\n\n  useEffect(() => {\n    fetch(\"/api/admin/settings/content\", { cache: \"no-store\" })\n      .then((res) => {\n        if (!res.ok) throw new Error(\"Kunne ikke hente tekster.\");\n        return res.json() as Promise<{ membershipNoticeHtml: string; footerHtml: string }>;\n      })\n      .then((data) => {\n        setMembershipNoticeHtml(data.membershipNoticeHtml);\n        setFooterHtml(data.footerHtml);\n      })\n      .catch(() => setContentLoadError(\"Kunne ikke hente tekster akkurat n\u00e5.\"))\n      .finally(() => setContentLoading(false));\n  }, []);\n\n  useEffect(() => {\n    fetch(\"/api/admin/settings/branding\", { cache: \"no-store\" })",
    "branding/content-state-and-fetch",
    "// --- Tekster p\u00e5 bookingsiden (medlemskapsnotis + bunntekst) ---",
) and ok

ok = apply_regex(
    P_BRANDING,
    "\\ \\ \\ \\ \\}\\ catch\\ \\{\\\n\\ \\ \\ \\ \\ \\ setSaveMessage\\(\\{\\ ok:\\ false,\\ text:\\ \"Kunne\\ ikke\\ lagre\\ akkurat\\ n.*?\\.\"\\ \\}\\);\\\n\\ \\ \\ \\ \\}\\ finally\\ \\{\\\n\\ \\ \\ \\ \\ \\ setSaving\\(false\\);\\\n\\ \\ \\ \\ \\}\\\n\\ \\ \\}\\\n\\\n\\ \\ const\\ previewLogo\\ =\\ pendingLogo\\ \\?\\?\\ \\(removeLogo\\ \\?\\ null\\ :\\ savedLogo\\);",
    "    } catch {\n      setSaveMessage({ ok: false, text: \"Kunne ikke lagre akkurat n\u00e5.\" });\n    } finally {\n      setSaving(false);\n    }\n  }\n\n  async function saveContentField(\n    field: \"membershipNoticeHtml\" | \"footerHtml\",\n    value: string | null,\n    setSavingState: (v: boolean) => void,\n    setMessage: (v: { ok: boolean; text: string } | null) => void,\n    applyValue: (v: string) => void,\n    bumpResetToken?: () => void\n  ) {\n    setSavingState(true);\n    setMessage(null);\n    try {\n      const res = await fetch(\"/api/admin/settings/content\", {\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" },\n        body: JSON.stringify({ [field]: value }),\n      });\n      const data = (await res.json()) as { error?: string } & Partial<{ membershipNoticeHtml: string; footerHtml: string }>;\n\n      if (!res.ok) {\n        setMessage({ ok: false, text: data.error ?? \"Kunne ikke lagre.\" });\n        return;\n      }\n\n      const next = data[field];\n      if (next !== undefined) applyValue(next);\n      if (value === null) bumpResetToken?.();\n      setMessage({ ok: true, text: value === null ? \"Tilbakestilt til standard.\" : \"Lagret.\" });\n    } catch {\n      setMessage({ ok: false, text: value === null ? \"Kunne ikke tilbakestille akkurat n\u00e5.\" : \"Kunne ikke lagre akkurat n\u00e5.\" });\n    } finally {\n      setSavingState(false);\n    }\n  }\n\n  function handleSaveNotice() {\n    saveContentField(\"membershipNoticeHtml\", membershipNoticeHtml, setSavingNotice, setNoticeMessage, setMembershipNoticeHtml);\n  }\n\n  function handleResetNotice() {\n    saveContentField(\"membershipNoticeHtml\", null, setSavingNotice, setNoticeMessage, setMembershipNoticeHtml, () =>\n      setNoticeResetToken((t) => t + 1)\n    );\n  }\n\n  function handleSaveFooter() {\n    saveContentField(\"footerHtml\", footerHtml, setSavingFooter, setFooterMessage, setFooterHtml);\n  }\n\n  function handleResetFooter() {\n    saveContentField(\"footerHtml\", null, setSavingFooter, setFooterMessage, setFooterHtml, () => setFooterResetToken((t) => t + 1));\n  }\n\n  const previewLogo = pendingLogo ?? (removeLogo ? null : savedLogo);",
    "branding/content-handlers",
    "async function saveContentField(",
) and ok

ok = apply_regex(
    P_BRANDING,
    "\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <button\\ type=\"submit\"\\ className=\\{styles\\.submitButton\\}\\ disabled=\\{saving\\}\\ style=\\{\\{\\ marginTop:\\ 10\\ \\}\\}>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\{saving\\ \\?\\ \"Lagrer\\ .*?\"\\ :\\ \"Lagre\"\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ </button>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ </form>\\\n\\ \\ \\ \\ \\ \\ \\ \\ </div>\\\n\\ \\ \\ \\ \\ \\ \\)\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ </div>\\\n\\ \\ \\ \\ \\ \\ </main>\\\n\\ \\ \\ \\ </>\\\n\\ \\ \\);\\\n\\}",
    "            <button type=\"submit\" className={styles.submitButton} disabled={saving} style={{ marginTop: 10 }}>\n              {saving ? \"Lagrer \u2026\" : \"Lagre\"}\n            </button>\n          </form>\n        </div>\n      )}\n\n      {contentLoading && <p>Laster \u2026</p>}\n      {contentLoadError && <p className={styles.error}>{contentLoadError}</p>}\n\n      {!contentLoading && !contentLoadError && (\n        <div className={styles.card}>\n          <h2 style={{ marginTop: 0, fontSize: \"1.1rem\" }}>Tekster p\u00e5 bookingsiden</h2>\n          <p className={styles.bookingMeta}>\n            De to korte tekstene som vises \u00f8verst og nederst p\u00e5 selve bookingsiden. Du kan gj\u00f8re tekst fet, kursiv\n            eller understreket, og legge til lenker.\n          </p>\n\n          <div className={styles.formRow}>\n            <label>Medlemskapsnotis (vises rett over kalenderen)</label>\n            <RichTextEditor\n              value={membershipNoticeHtml}\n              onChange={setMembershipNoticeHtml}\n              resetToken={noticeResetToken}\n              disabled={savingNotice}\n            />\n            {noticeMessage && (\n              <p className={noticeMessage.ok ? styles.success : styles.error} style={{ marginTop: 6 }}>\n                {noticeMessage.text}\n              </p>\n            )}\n            <div style={{ display: \"flex\", gap: \"8px\", marginTop: 8 }}>\n              <button type=\"button\" className={styles.submitButton} disabled={savingNotice} onClick={handleSaveNotice}>\n                {savingNotice ? \"Lagrer \u2026\" : \"Lagre\"}\n              </button>\n              <button\n                type=\"button\"\n                className={styles.secondaryButton}\n                disabled={savingNotice}\n                onClick={handleResetNotice}\n              >\n                Tilbakestill til standard\n              </button>\n            </div>\n          </div>\n\n          <div className={styles.formRow} style={{ marginTop: 20 }}>\n            <label>Bunntekst (vises nederst p\u00e5 siden)</label>\n            <RichTextEditor\n              value={footerHtml}\n              onChange={setFooterHtml}\n              resetToken={footerResetToken}\n              disabled={savingFooter}\n            />\n            {footerMessage && (\n              <p className={footerMessage.ok ? styles.success : styles.error} style={{ marginTop: 6 }}>\n                {footerMessage.text}\n              </p>\n            )}\n            <div style={{ display: \"flex\", gap: \"8px\", marginTop: 8 }}>\n              <button type=\"button\" className={styles.submitButton} disabled={savingFooter} onClick={handleSaveFooter}>\n                {savingFooter ? \"Lagrer \u2026\" : \"Lagre\"}\n              </button>\n              <button\n                type=\"button\"\n                className={styles.secondaryButton}\n                disabled={savingFooter}\n                onClick={handleResetFooter}\n              >\n                Tilbakestill til standard\n              </button>\n            </div>\n          </div>\n        </div>\n      )}\n        </div>\n      </main>\n    </>\n  );\n}",
    "branding/content-card-jsx",
    "Tekster p\u00e5 bookingsiden</h2>",
) and ok

ok = apply_regex(
    P_ADMINCSS,
    "\\.reminderBannerDanger\\ \\{\\\n\\ \\ background:\\ var\\(\\-\\-conflict\\-bg\\);\\\n\\ \\ border:\\ 1px\\ solid\\ var\\(\\-\\-conflict\\-border\\);\\\n\\ \\ color:\\ var\\(\\-\\-danger\\-dark\\);\\\n\\}\\\n",
    ".reminderBannerDanger {\n  background: var(--conflict-bg);\n  border: 1px solid var(--conflict-border);\n  color: var(--danger-dark);\n}\n\n\n/* ---- Rik-tekst-editor for tekstene p\u00e5 bookingsiden (medlemskapsnotis +\n   bunntekst) - se app/admin/branding/RichTextEditor.tsx. ---- */\n\n.richTextField {\n  border: 1px solid var(--border);\n  border-radius: 10px;\n  overflow: hidden;\n}\n\n.richTextToolbar {\n  display: flex;\n  gap: 4px;\n  padding: 6px;\n  border-bottom: 1px solid var(--border);\n  background: var(--available);\n  flex-wrap: wrap;\n}\n\n.richTextButton {\n  padding: 4px 10px;\n  border: 1px solid var(--border);\n  border-radius: 6px;\n  background: var(--surface);\n  color: var(--ink);\n  font-size: 0.85rem;\n  cursor: pointer;\n}\n\n.richTextButton:hover:not(:disabled) {\n  border-color: var(--brand);\n  color: var(--brand);\n}\n\n.richTextButton:disabled {\n  opacity: 0.5;\n  cursor: default;\n}\n\n.richTextEditable {\n  min-height: 70px;\n  padding: 10px 12px;\n  font-size: 0.95rem;\n  line-height: 1.5;\n  outline: none;\n}\n\n.richTextEditable a {\n  color: var(--brand);\n}\n\n/* ---- Varighetsvelger (30 min / 1 time) for admins manuelle booking - se\n   \"Book uten betaling\"-modalen i app/admin/BookingsInsights.tsx. ---- */\n\n.durationToggle {\n  display: flex;\n  gap: 8px;\n  margin-bottom: 14px;\n}\n\n.durationToggleButton {\n  padding: 8px 16px;\n  border: 1.5px solid var(--border);\n  border-radius: 8px;\n  background: var(--surface);\n  color: var(--ink);\n  font-size: 0.9rem;\n  font-weight: 600;\n  cursor: pointer;\n}\n\n.durationToggleButtonActive {\n  border-color: var(--brand);\n  background: var(--brand);\n  color: white;\n}\n",
    "admincss/append-richtext-duration-css",
    ".richTextField {",
) and ok

ok = apply_regex(
    P_MANUAL,
    "import\\ \\{\\ NextRequest,\\ NextResponse\\ \\}\\ from\\ \"next/server\";\\\nimport\\ \\{\\ getRepository\\ \\}\\ from\\ \"@/lib/db\";\\\nimport\\ \\{\\ isValidBookingDateString,\\ isWithinOpeningHours,\\ occurrenceRange\\ \\}\\ from\\ \"@/lib/slots\";\\\nimport\\ \\{\\ normalizeNorwegianMobile\\ \\}\\ from\\ \"@/lib/phone\";\\\nimport\\ \\{\\ durationMinutesToSlots\\ \\}\\ from\\ \"@/lib/config\";\\\nimport\\ \\{\\ effectiveHoursForDate,\\ getHoursContext\\ \\}\\ from\\ \"@/lib/settings/openingHours\";\\\nimport\\ \\{\\ getPricingSettings,\\ priceForDuration\\ \\}\\ from\\ \"@/lib/settings/pricing\";\\\n\\\nexport\\ const\\ dynamic\\ =\\ \"force\\-dynamic\";\\\n\\\n/\\*\\*\\ Admins\\ manuelle\\ booking\\ \\(uten\\ betaling\\)\\ er\\ alltid\\ n.*?yaktig\\ 1\\ time\\ .*?\\ se\\ kommentaren\\ under\\.\\ \\*/\\\nconst\\ MANUAL_BOOKING_DURATION_SLOTS\\ =\\ durationMinutesToSlots\\(60\\);\\\n\\\ninterface\\ ManualBookingBody\\ \\{\\\n\\ \\ date\\?:\\ string;\\\n\\ \\ time\\?:\\ string;\\\n\\ \\ name\\?:\\ string;\\\n\\ \\ phone\\?:\\ string;\\\n\\}",
    "import { NextRequest, NextResponse } from \"next/server\";\nimport { getRepository } from \"@/lib/db\";\nimport { isValidBookingDateString, isWithinOpeningHours, occurrenceRange } from \"@/lib/slots\";\nimport { normalizeNorwegianMobile } from \"@/lib/phone\";\nimport { durationMinutesToSlots, isBookableDurationMinutes, type BookingDurationMinutes } from \"@/lib/config\";\nimport { effectiveHoursForDate, getHoursContext } from \"@/lib/settings/openingHours\";\nimport { getPricingSettings, priceForDuration } from \"@/lib/settings/pricing\";\n\nexport const dynamic = \"force-dynamic\";\n\ninterface ManualBookingBody {\n  date?: string;\n  time?: string;\n  name?: string;\n  phone?: string;\n  /** 30 eller 60 (minutter) \u2013 utelatt betyr 60, den gamle, faste varigheten. */\n  durationMinutes?: number;\n}",
    "manual/imports-and-body-type",
    "/** 30 eller 60 (minutter) \u2013 utelatt betyr 60, den gamle, faste varigheten. */",
) and ok

ok = apply_regex(
    P_MANUAL,
    "/\\*\\*\\\n\\ \\*\\ POST\\ /api/admin/bookings/manual\\\n\\ \\*\\ Body:\\ \\{\\ date:\\ \"YYYY\\-MM\\-DD\",\\ time:\\ \"HH:mm\",\\ name:\\ string,\\ phone\\?:\\ string\\ \\}\\\n\\ \\*\\\n\\ \\*\\ Admin\\ booker\\ en\\ time\\ direkte\\ p.*?\\ vegne\\ av\\ en\\ kunde\\ \\(f\\.eks\\.\\ betalt\\ kontant,\\\n\\ \\*\\ eller\\ bare\\ registrert\\ manuelt\\)\\ .*?\\ ingen\\ betaling\\ involvert,\\ bindende\\ med\\ en\\\n\\ \\*\\ gang\\.\\ Varigheten\\ er\\ alltid\\ n.*?yaktig\\ 1\\ time,\\ akkurat\\ som\\ en\\ vanlig\\ booking\\\n\\ \\*\\ .*?\\ samme\\ rutenett\\ og\\ .*?pningstider\\ gjelder,\\ se\\ app/api/squash/bookings/route\\.ts\\.\\\n\\ \\*/\\\nexport\\ async\\ function\\ POST\\(request:\\ NextRequest\\)\\ \\{",
    "/**\n * POST /api/admin/bookings/manual\n * Body: { date: \"YYYY-MM-DD\", time: \"HH:mm\", name: string, phone?: string, durationMinutes?: 30 | 60 }\n *\n * Admin booker en time direkte p\u00e5 vegne av en kunde (f.eks. betalt kontant,\n * eller bare registrert manuelt) \u2013 ingen betaling involvert, bindende med en\n * gang. Varigheten er 30 minutter eller 1 time, samme valg som en vanlig\n * booking har (se BOOKABLE_DURATIONS_MINUTES i lib/config.ts) \u2013 1 time er\n * fortsatt forh\u00e5ndsvalgt som standard, siden det var den gamle, faste\n * oppf\u00f8rselen. Samme rutenett og \u00e5pningstider gjelder uansett, se\n * app/api/squash/bookings/route.ts.\n */\nexport async function POST(request: NextRequest) {",
    "manual/doc-comment",
    "Varigheten er 30 minutter eller 1 time, samme valg som en vanlig",
) and ok

ok = apply_regex(
    P_MANUAL,
    "\\ \\ if\\ \\(!time\\ \\|\\|\\ !/\\^\\\\d\\{2\\}:\\\\d\\{2\\}\\$/\\.test\\(time\\)\\)\\ \\{\\\n\\ \\ \\ \\ return\\ NextResponse\\.json\\(\\{\\ error:\\ \"Ugyldig\\ klokkeslett\\.\"\\ \\},\\ \\{\\ status:\\ 400\\ \\}\\);\\\n\\ \\ \\}\\\n\\ \\ if\\ \\(name\\.length\\ <\\ 2\\ \\|\\|\\ name\\.length\\ >\\ 100\\)\\ \\{",
    "  if (!time || !/^\\d{2}:\\d{2}$/.test(time)) {\n    return NextResponse.json({ error: \"Ugyldig klokkeslett.\" }, { status: 400 });\n  }\n\n  const durationMinutes: BookingDurationMinutes = isBookableDurationMinutes(body.durationMinutes)\n    ? body.durationMinutes\n    : 60;\n\n  if (name.length < 2 || name.length > 100) {",
    "manual/parse-duration",
    "const durationMinutes: BookingDurationMinutes = isBookableDurationMinutes(body.durationMinutes)",
) and ok

ok = apply_regex(
    P_MANUAL,
    "\\ \\ const\\ range\\ =\\ occurrenceRange\\(date,\\ time,\\ MANUAL_BOOKING_DURATION_SLOTS\\);",
    "  const range = occurrenceRange(date, time, durationMinutesToSlots(durationMinutes));",
    "manual/occurrence-range",
    "occurrenceRange(date, time, durationMinutesToSlots(durationMinutes));",
) and ok

ok = apply_regex(
    P_MANUAL,
    "\\ \\ \\ \\ totalAmountOre:\\ priceForDuration\\(pricing,\\ 60\\),",
    "    totalAmountOre: priceForDuration(pricing, durationMinutes),",
    "manual/price-for-duration",
    "priceForDuration(pricing, durationMinutes),",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ const\\ \\[modal,\\ setModal\\]\\ =\\ useState<ModalState\\ \\|\\ null>\\(null\\);\\\n\\ \\ const\\ \\[manualTime,\\ setManualTime\\]\\ =\\ useState\\(\"\"\\);\\\n\\ \\ const\\ \\[manualName,\\ setManualName\\]\\ =\\ useState\\(\"\"\\);",
    "  const [modal, setModal] = useState<ModalState | null>(null);\n  const [manualTime, setManualTime] = useState(\"\");\n  // Varighet for en NY manuell booking (kun relevant i \"create\"-modus \u2013 en\n  // redigering beholder alltid bookingens egen, opprinnelige varighet, se\n  // modalDurationMinutes under). 60 min er fortsatt forh\u00e5ndsvalgt, akkurat\n  // som f\u00f8r dette ble valgbart.\n  const [manualDurationMinutes, setManualDurationMinutes] = useState<30 | 60>(60);\n  const [manualName, setManualName] = useState(\"\");",
    "bi/duration-state",
    "const [manualDurationMinutes, setManualDurationMinutes] = useState<30 | 60>(60);",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ //\\ Admin\\ sin\\ manuelle\\ booking\\ er\\ alltid\\ n.*?yaktig\\ 1\\ time\\ n.*?r\\ man\\ OPPRETTER\\ en\\\n\\ \\ //\\ ny\\ \\(se\\ app/api/admin/bookings/manual/route\\.ts\\)\\ .*?\\ men\\ n.*?r\\ man\\ REDIGERER\\ en\\\n\\ \\ //\\ eksisterende\\ booking\\ sitt\\ klokkeslett,\\ beholdes\\ bookingens\\ EGEN,\\\n\\ \\ //\\ opprinnelige\\ varighet\\ \\(30\\ min\\ eller\\ 1\\ time,\\ se\\\n\\ \\ //\\ app/api/admin/bookings/\\[id\\]/route\\.ts\\),\\ s.*?\\ rutenettet\\ m.*?\\ vite\\ hvilken\\ av\\\n\\ \\ //\\ de\\ to\\ det\\ gjelder,\\ b.*?de\\ for\\ hvilke\\ celler\\ som\\ er\\ valgbare\\ OG\\ om\\ valget\\\n\\ \\ //\\ skal\\ vises\\ som\\ .*?n\\ eller\\ to\\ sammensl.*?tte\\ halvtimer\\.\\\n\\ \\ const\\ modalDurationMinutes\\ =\\ modal\\ ===\\ null\\ \\?\\ 60\\ :\\ modal\\.mode\\ ===\\ \"create\"\\ \\?\\ 60\\ :\\ modal\\.durationMinutes;",
    "  // Admin sin manuelle booking har samme to valg som en vanlig booking (30\n  // min eller 1 time, se durationToggle-knappene i modalen under) n\u00e5r man\n  // OPPRETTER en ny (se app/api/admin/bookings/manual/route.ts) \u2013 men n\u00e5r\n  // man REDIGERER en eksisterende booking sitt klokkeslett, beholdes\n  // bookingens EGEN, opprinnelige varighet (se\n  // app/api/admin/bookings/[id]/route.ts) i stedet, s\u00e5 rutenettet m\u00e5 vite\n  // hvilken av de to det gjelder, b\u00e5de for hvilke celler som er valgbare OG\n  // om valget skal vises som \u00e9n eller to sammensl\u00e5tte halvtimer.\n  const modalDurationMinutes = modal === null ? 60 : modal.mode === \"create\" ? manualDurationMinutes : modal.durationMinutes;",
    "bi/modal-duration-computation",
    "modal.mode === \"create\" ? manualDurationMinutes : modal.durationMinutes;",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ function\\ openCreateModal\\(dateStr:\\ string\\)\\ \\{\\\n\\ \\ \\ \\ setModal\\(\\{\\ mode:\\ \"create\",\\ date:\\ dateStr\\ \\}\\);\\\n\\ \\ \\ \\ setManualTime\\(\"\"\\);\\\n\\ \\ \\ \\ setManualName\\(\"\"\\);\\\n\\ \\ \\ \\ setManualPhone\\(\"\"\\);\\\n\\ \\ \\ \\ setManualError\\(null\\);\\\n\\ \\ \\}",
    "  function openCreateModal(dateStr: string) {\n    setModal({ mode: \"create\", date: dateStr });\n    setManualTime(\"\");\n    setManualDurationMinutes(60);\n    setManualName(\"\");\n    setManualPhone(\"\");\n    setManualError(null);\n  }",
    "bi/open-create-modal-reset",
    "setManualDurationMinutes(60);\n    setManualName(\"\");",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ \\ \\ \\ \\ \\ \\ const\\ res\\ =\\ await\\ fetch\\(\"/api/admin/bookings/manual\",\\ \\{\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ method:\\ \"POST\",\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ headers:\\ \\{\\ \"Content\\-Type\":\\ \"application/json\"\\ \\},\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ body:\\ JSON\\.stringify\\(\\{\\ date:\\ modal\\.date,\\ time:\\ manualTime,\\ name:\\ manualName,\\ phone:\\ manualPhone\\ \\}\\),\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\}\\);",
    "        const res = await fetch(\"/api/admin/bookings/manual\", {\n          method: \"POST\",\n          headers: { \"Content-Type\": \"application/json\" },\n          body: JSON.stringify({\n            date: modal.date,\n            time: manualTime,\n            name: manualName,\n            phone: manualPhone,\n            durationMinutes: manualDurationMinutes,\n          }),\n        });",
    "bi/submit-body-duration",
    "durationMinutes: manualDurationMinutes,",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ <p\\ className=\\{styles\\.bookingMeta\\}>\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\{modal\\.mode\\ ===\\ \"create\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\?\\ \"Bookingen\\ varer\\ alltid\\ 1\\ time\\ og\\ er\\ bekreftet\\ med\\ en\\ gang,\\ uten\\ Vipps\\.\"\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ :\\ modal\\.status\\ ===\\ \"cancelled\"",
    "            <p className={styles.bookingMeta}>\n              {modal.mode === \"create\"\n                ? \"Bookingen er bekreftet med en gang, uten Vipps.\"\n                : modal.status === \"cancelled\"",
    "bi/modal-description-text",
    "\"Bookingen er bekreftet med en gang, uten Vipps.\"",
) and ok

ok = apply_regex(
    P_BI,
    "\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ :\\ \"Klokkeslett\\ kan\\ ikke\\ endres\\ her\\ for\\ gjentakende\\ bookinger\\ eller\\ blokkeringer\\ .*?\\ kun\\ navn/telefon\\.\"\\}\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ </p>\\\n\\\n\\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\ \\{needsSlotGrid\\ \\&\\&\\ \\(",
    "                    : \"Klokkeslett kan ikke endres her for gjentakende bookinger eller blokkeringer \u2013 kun navn/telefon.\"}\n            </p>\n\n            {modal.mode === \"create\" && (\n              <div className={styles.durationToggle}>\n                <button\n                  type=\"button\"\n                  className={`${styles.durationToggleButton} ${\n                    manualDurationMinutes === 30 ? styles.durationToggleButtonActive : \"\"\n                  }`}\n                  onClick={() => {\n                    setManualDurationMinutes(30);\n                    setManualTime(\"\");\n                  }}\n                >\n                  30 min\n                </button>\n                <button\n                  type=\"button\"\n                  className={`${styles.durationToggleButton} ${\n                    manualDurationMinutes === 60 ? styles.durationToggleButtonActive : \"\"\n                  }`}\n                  onClick={() => {\n                    setManualDurationMinutes(60);\n                    setManualTime(\"\");\n                  }}\n                >\n                  1 time\n                </button>\n              </div>\n            )}\n\n            {needsSlotGrid && (",
    "bi/duration-toggle-jsx",
    "styles.durationToggle}>",
) and ok

print()
if not ok:
    print("SOME STEPS WERE SKIPPED - see [SKIPPED] messages above.")
    print("Ingenting annet ble kjort (ingen typecheck).")
    sys.exit(1)

print("Alle filer opprettet/endret (eller var allerede gjort fra for).")
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
