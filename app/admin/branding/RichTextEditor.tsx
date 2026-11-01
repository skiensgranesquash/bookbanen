"use client";

import { useEffect, useRef } from "react";
import styles from "../admin.module.css";

interface RichTextEditorProps {
  /** Gjeldende lagrede HTML – kun brukt til å sette INNHOLDET når editoren først vises eller når `resetToken` endres, ellers styrer nettleseren selv redigeringen (en fullt kontrollert contentEditable ville "hoppe" markøren ved hvert tastetrykk). */
  value: string;
  onChange: (html: string) => void;
  /** Økes av parent for å tvinge innholdet til å bli satt på nytt fra `value` (f.eks. rett etter "Tilbakestill til standard"). */
  resetToken: number;
  disabled?: boolean;
}

/**
 * Minimal rik-tekst-editor for de to korte tekstene på bookingsiden
 * (medlemskapsnotisen og bunnteksten, se app/admin/branding/BrandingManager.tsx)
 * – kun fet/kursiv/understreket/lenke, ikke et fullverdig tekstbehandlings-
 * verktøy. Bruker den innebygde `contentEditable` + `document.execCommand`
 * (fortsatt støttet i alle store nettlesere for nøyaktig disse enkle
 * kommandoene, selv om API-et er merket "deprecated" i spesifikasjonen) – et
 * fullverdig rik-tekst-bibliotek ville vært unødvendig tungt for to små
 * tekstbokser brukt av noen få administratorer.
 *
 * Selve HTML-en som til slutt lagres saneres likevel ALLTID på SERVER-siden
 * (se sanitizeRichTextHtml i lib/settings/pageContent.ts) – denne editoren
 * styrer bare hvordan det ser ut mens man skriver, ikke selve sikkerheten.
 */
export default function RichTextEditor({ value, onChange, resetToken, disabled }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const lastResetToken = useRef(resetToken);

  // Sett innholdet ÉN gang når editoren først monteres (fra den lagrede
  // verdien som allerede er hentet av parent på det tidspunktet).
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sett innholdet på nytt KUN når parent bevisst ber om det (resetToken
  // endres etter en vellykket "Tilbakestill til standard") – IKKE ved hvert
  // tastetrykk, siden `value` da allerede kommer fra denne samme editoren.
  useEffect(() => {
    if (resetToken !== lastResetToken.current) {
      if (ref.current) ref.current.innerHTML = value;
      lastResetToken.current = resetToken;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken]);

  function exec(command: string, arg?: string) {
    if (disabled) return;
    ref.current?.focus();
    document.execCommand(command, false, arg);
    if (ref.current) onChange(ref.current.innerHTML);
  }

  function handleLink() {
    if (disabled) return;
    const url = window.prompt("Lenkeadresse (https://... eller mailto:...)");
    if (!url) return;
    const trimmed = url.trim();
    const normalized = /^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    exec("createLink", normalized);
  }

  return (
    <div className={styles.richTextField}>
      <div className={styles.richTextToolbar}>
        <button
          type="button"
          className={styles.richTextButton}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("bold")}
          title="Fet"
        >
          <strong>F</strong>
        </button>
        <button
          type="button"
          className={styles.richTextButton}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("italic")}
          title="Kursiv"
        >
          <em>K</em>
        </button>
        <button
          type="button"
          className={styles.richTextButton}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("underline")}
          title="Understrek"
        >
          <u>U</u>
        </button>
        <button
          type="button"
          className={styles.richTextButton}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleLink}
          title="Legg til lenke"
        >
          Lenke
        </button>
        <button
          type="button"
          className={styles.richTextButton}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("unlink")}
          title="Fjern lenke"
        >
          Fjern lenke
        </button>
      </div>
      <div
        ref={ref}
        className={styles.richTextEditable}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={() => {
          if (ref.current) onChange(ref.current.innerHTML);
        }}
      />
    </div>
  );
}
