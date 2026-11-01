import "server-only";
import { getRepository } from "@/lib/db";

/**
 * De to korte, redigerbare tekstene på selve bookingsiden (se app/page.tsx):
 * medlemskapsnotisen rett over kalenderen, og bunnteksten nederst. Satt via
 * adminpanelet under "Utseende" (se app/admin/branding/BrandingManager.tsx og
 * app/admin/branding/RichTextEditor.tsx), lagret i den samme generiske
 * nøkkel/verdi-innstillingstabellen som resten av innstillingene (samme
 * mønster som lib/settings/branding.ts).
 *
 * Teksten kan inneholde enkel formattering (fet/kursiv/understreket) og
 * lenker – ALDRI noe annet. Siden dette til slutt rendres rett inn på den
 * offentlige bookingsiden med `dangerouslySetInnerHTML` (se app/page.tsx),
 * saneres HTML-en strengt via `sanitizeRichTextHtml` under – både når en
 * administrator lagrer den OG på nytt hver gang den leses tilbake, som et
 * ekstra sikkerhetslag i tilfelle noe usanert noensinne skulle havne direkte
 * i databasen (f.eks. ved en fremtidig kodeendring eller et direkte
 * databaseoppslag).
 */

const MEMBERSHIP_NOTICE_KEY = "pageContentMembershipNoticeHtml";
const FOOTER_KEY = "pageContentFooterHtml";

/** Kun disse taggene overlever saneringen – ingen andre, og ingen attributter bortsett fra `href` på `<a>` (se sanitizeRichTextHtml). */
const ALLOWED_INLINE_TAGS = new Set(["b", "strong", "i", "em", "u"]);

/** Et grovt tak på lengden – dette skal være noen setninger, ikke en hel artikkel. */
const MAX_HTML_LENGTH = 4000;

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Kun http(s)- eller mailto-lenker regnes som trygge – aldri `javascript:`, `data:` eller andre skjema. */
function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  if (/^https?:\/\/[^\s<>"]+$/i.test(trimmed)) return true;
  return /^mailto:[^\s<>"]+@[^\s<>"]+$/i.test(trimmed);
}

/**
 * Saner rik-tekst-HTML ned til et svært lite, trygt utvalg: fet/kursiv/
 * understreket tekst og vanlige http(s)/mailto-lenker – INGENTING annet
 * overlever (ingen script/style/bilder/iframer, ingen andre tagger, ingen
 * attributter bortsett fra en validert `href` på `<a>`, ingen
 * event-handlere). Tolererer også ubalansert/rotete HTML uten å kaste –
 * tagger som blir stående åpne lukkes automatisk til slutt, og overflødige
 * lukketagger droppes stille, slik at en innlimt/forhastet tekst aldri kan
 * "lekke" formattering utover resten av siden.
 *
 * Brukt BÅDE når en administrator lagrer en tekst (se savePageContent under)
 * OG hver gang den leses tilbake (se getPageContent) – se filkommentaren
 * øverst for hvorfor.
 */
export function sanitizeRichTextHtml(input: string): string {
  if (!input) return "";

  // Fjern <script>/<style>-blokker (og ALT innhold mellom dem) helt, før noe
  // annet behandles, slik at innholdet deres aldri "lekker ut" som vanlig
  // tekst lenger ned. Fjern også HTML-kommentarer (kan ellers brukes til å
  // smugle innhold forbi en naiv tagg-for-tagg-sanering).
  let working = input.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");
  working = working.replace(/<!--[\s\S]*?-->/g, "");

  const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*)?)\/?>/g;
  let output = "";
  let lastIndex = 0;
  const openStack: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(working)) !== null) {
    output += working.slice(lastIndex, match.index);
    lastIndex = tagPattern.lastIndex;

    const raw = match[0];
    const tagName = match[1].toLowerCase();
    const attrText = match[2] ?? "";
    const isClosing = raw.startsWith("</");

    if (tagName === "br") {
      if (!isClosing) output += "<br>";
      continue;
    }

    if (tagName === "a") {
      if (isClosing) {
        if (openStack.includes("a")) {
          while (openStack.length > 0) {
            const tag = openStack.pop() as string;
            output += `</${tag}>`;
            if (tag === "a") break;
          }
        }
        continue;
      }
      const hrefMatch = /href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i.exec(attrText);
      const hrefRaw = hrefMatch ? hrefMatch[1] ?? hrefMatch[2] ?? "" : "";
      // Ingen gyldig href - dropp hele <a>-taggen (teksten inni beholdes som
      // vanlig, ikke-klikkbar tekst) i stedet for å lage en ødelagt lenke.
      if (!isSafeHref(hrefRaw)) continue;
      output += `<a href="${escapeAttr(hrefRaw.trim())}" target="_blank" rel="noopener noreferrer">`;
      openStack.push("a");
      continue;
    }

    if (ALLOWED_INLINE_TAGS.has(tagName)) {
      if (isClosing) {
        if (openStack.includes(tagName)) {
          while (openStack.length > 0) {
            const tag = openStack.pop() as string;
            output += `</${tag}>`;
            if (tag === tagName) break;
          }
        }
        continue;
      }
      output += `<${tagName}>`;
      openStack.push(tagName);
      continue;
    }

    // Ukjent/ikke tillatt tagg (f.eks. <img>, <div>, <span style=...>) -
    // dropp selve taggen, men behold teksten inni den (den fjernes ikke).
  }

  output += working.slice(lastIndex);

  // Lukk eventuelle tagger som ble stående åpne (f.eks. en <b> uten </b>) -
  // uten dette kunne ubalansert markup fra editoren i verste fall
  // fetet/kursivert resten av siden under den.
  while (openStack.length > 0) {
    output += `</${openStack.pop()}>`;
  }

  return output.length > MAX_HTML_LENGTH ? output.slice(0, MAX_HTML_LENGTH) : output;
}

export const DEFAULT_MEMBERSHIP_NOTICE_HTML =
  'For å booke bane må du ha tilgang til banen gjennom medlemskap i <a href="https://www.skiensgrane.no/squash" target="_blank" rel="noopener noreferrer">Skiens Grane Squash</a> eller <a href="https://www.mova.no/treningssenter/skien/hovedsenter" target="_blank" rel="noopener noreferrer">Mova Skien</a>. Du bekrefter dette før du går videre til betaling.';

export const DEFAULT_FOOTER_HTML =
  '<a href="https://www.skiensgrane.no/squash" target="_blank" rel="noopener noreferrer">Bli medlem av Skiens Grane Squash</a> &middot; <a href="https://www.mova.no/treningssenter/skien/hovedsenter" target="_blank" rel="noopener noreferrer">Mova Skien – åpningstider</a>';

export interface PageContent {
  membershipNoticeHtml: string;
  footerHtml: string;
}

export async function getPageContent(): Promise<PageContent> {
  const repo = await getRepository();
  const [storedNotice, storedFooter] = await Promise.all([
    repo.getSetting(MEMBERSHIP_NOTICE_KEY),
    repo.getSetting(FOOTER_KEY),
  ]);
  return {
    membershipNoticeHtml:
      storedNotice && storedNotice.trim() ? sanitizeRichTextHtml(storedNotice) : DEFAULT_MEMBERSHIP_NOTICE_HTML,
    footerHtml: storedFooter && storedFooter.trim() ? sanitizeRichTextHtml(storedFooter) : DEFAULT_FOOTER_HTML,
  };
}

export interface SavePageContentInput {
  /** Utelatt felt endrer ikke den lagrede teksten. `null` tilbakestiller den til standardteksten. */
  membershipNoticeHtml?: string | null;
  footerHtml?: string | null;
}

/** Validerer (lengde) og lagrer én eller begge tekstene – saner alltid HTML-en før den lagres, se sanitizeRichTextHtml over. */
export async function savePageContent(input: SavePageContentInput): Promise<PageContent> {
  const repo = await getRepository();

  if (input.membershipNoticeHtml !== undefined) {
    await repo.setSetting(
      MEMBERSHIP_NOTICE_KEY,
      input.membershipNoticeHtml === null ? "" : sanitizeRichTextHtml(input.membershipNoticeHtml)
    );
  }
  if (input.footerHtml !== undefined) {
    await repo.setSetting(FOOTER_KEY, input.footerHtml === null ? "" : sanitizeRichTextHtml(input.footerHtml));
  }

  return getPageContent();
}
