"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "../admin.module.css";
import AdminNav from "../AdminNav";
import RichTextEditor from "./RichTextEditor";

interface Branding {
  clubName: string;
  logoDataUrl: string | null;
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Kunne ikke lese filen."));
    reader.readAsDataURL(file);
  });
}

export default function BrandingManager() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [clubName, setClubName] = useState("");
  const [savedLogo, setSavedLogo] = useState<string | null>(null);
  const [pendingLogo, setPendingLogo] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // --- Tekster på bookingsiden (medlemskapsnotis + bunntekst) ---
  const [membershipNoticeHtml, setMembershipNoticeHtml] = useState("");
  const [footerHtml, setFooterHtml] = useState("");
  const [contentLoading, setContentLoading] = useState(true);
  const [contentLoadError, setContentLoadError] = useState<string | null>(null);
  const [savingNotice, setSavingNotice] = useState(false);
  const [savingFooter, setSavingFooter] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [footerMessage, setFooterMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Økes etter en vellykket "Tilbakestill til standard" for å tvinge
  // RichTextEditor til å sette innholdet sitt på nytt (se RichTextEditor.tsx).
  const [noticeResetToken, setNoticeResetToken] = useState(0);
  const [footerResetToken, setFooterResetToken] = useState(0);

  useEffect(() => {
    fetch("/api/admin/settings/content", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("Kunne ikke hente tekster.");
        return res.json() as Promise<{ membershipNoticeHtml: string; footerHtml: string }>;
      })
      .then((data) => {
        setMembershipNoticeHtml(data.membershipNoticeHtml);
        setFooterHtml(data.footerHtml);
      })
      .catch(() => setContentLoadError("Kunne ikke hente tekster akkurat nå."))
      .finally(() => setContentLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/admin/settings/branding", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("Kunne ikke hente innstillinger.");
        return res.json() as Promise<Branding>;
      })
      .then((data) => {
        setClubName(data.clubName);
        setSavedLogo(data.logoDataUrl);
      })
      .catch(() => setLoadError("Kunne ikke hente innstillinger akkurat nå."))
      .finally(() => setLoading(false));
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setFileError(null);

    if (!ALLOWED_TYPES.includes(file.type)) {
      setFileError("Ugyldig filtype – bruk PNG, JPG, WebP eller SVG.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setFileError(`Filen er for stor (maks ${Math.round(MAX_LOGO_BYTES / 1024 / 1024)} MB).`);
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setPendingLogo(dataUrl);
      setRemoveLogo(false);
    } catch {
      setFileError("Kunne ikke lese filen.");
    }
  }

  function handleRemoveLogo() {
    setPendingLogo(null);
    setRemoveLogo(true);
    setFileError(null);
  }

  function handleUndoRemove() {
    setRemoveLogo(false);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMessage(null);

    try {
      const body: { clubName: string; logoDataUrl?: string | null } = { clubName };
      if (pendingLogo) body.logoDataUrl = pendingLogo;
      else if (removeLogo) body.logoDataUrl = null;

      const res = await fetch("/api/admin/settings/branding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string } & Partial<Branding>;

      if (!res.ok) {
        setSaveMessage({ ok: false, text: data.error ?? "Kunne ikke lagre." });
        return;
      }

      if (data.clubName !== undefined) setClubName(data.clubName);
      if (data.logoDataUrl !== undefined) setSavedLogo(data.logoDataUrl);
      setPendingLogo(null);
      setRemoveLogo(false);
      setSaveMessage({ ok: true, text: "Lagret." });
    } catch {
      setSaveMessage({ ok: false, text: "Kunne ikke lagre akkurat nå." });
    } finally {
      setSaving(false);
    }
  }

  async function saveContentField(
    field: "membershipNoticeHtml" | "footerHtml",
    value: string | null,
    setSavingState: (v: boolean) => void,
    setMessage: (v: { ok: boolean; text: string } | null) => void,
    applyValue: (v: string) => void,
    bumpResetToken?: () => void
  ) {
    setSavingState(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/settings/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const data = (await res.json()) as { error?: string } & Partial<{ membershipNoticeHtml: string; footerHtml: string }>;

      if (!res.ok) {
        setMessage({ ok: false, text: data.error ?? "Kunne ikke lagre." });
        return;
      }

      const next = data[field];
      if (next !== undefined) applyValue(next);
      if (value === null) bumpResetToken?.();
      setMessage({ ok: true, text: value === null ? "Tilbakestilt til standard." : "Lagret." });
    } catch {
      setMessage({ ok: false, text: value === null ? "Kunne ikke tilbakestille akkurat nå." : "Kunne ikke lagre akkurat nå." });
    } finally {
      setSavingState(false);
    }
  }

  function handleSaveNotice() {
    saveContentField("membershipNoticeHtml", membershipNoticeHtml, setSavingNotice, setNoticeMessage, setMembershipNoticeHtml);
  }

  function handleResetNotice() {
    saveContentField("membershipNoticeHtml", null, setSavingNotice, setNoticeMessage, setMembershipNoticeHtml, () =>
      setNoticeResetToken((t) => t + 1)
    );
  }

  function handleSaveFooter() {
    saveContentField("footerHtml", footerHtml, setSavingFooter, setFooterMessage, setFooterHtml);
  }

  function handleResetFooter() {
    saveContentField("footerHtml", null, setSavingFooter, setFooterMessage, setFooterHtml, () => setFooterResetToken((t) => t + 1));
  }

  const previewLogo = pendingLogo ?? (removeLogo ? null : savedLogo);

  return (
    <>
      <AdminNav active="utseende" />
      <main className={styles.page}>
        <div className={styles.tabPanel}>
          <h1 className={styles.title}>Utseende</h1>
          <p className={styles.subtitle}>Klubbnavn og logo som vises på bookingsiden.</p>

      {loading && <p>Laster …</p>}
      {loadError && <p className={styles.error}>{loadError}</p>}

      {!loading && !loadError && (
        <div className={styles.card}>
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Klubbnavn og logo</h2>
          <p className={styles.bookingMeta}>
            Vises øverst på den offentlige bookingsiden, i stedet for &quot;IF Skiens Grane&quot; og standardlogoen.
            Fint hvis siden skal deles med eller gjenbrukes av andre.
          </p>

          <form onSubmit={handleSave} className={styles.form}>
            <div className={styles.formRow}>
              <label htmlFor="club-name">Klubb-/firmanavn</label>
              <input
                id="club-name"
                type="text"
                value={clubName}
                onChange={(e) => setClubName(e.target.value)}
                maxLength={80}
              />
            </div>

            <div className={styles.formRow}>
              <label>Logo</label>
              <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: "12px",
                    border: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    background: "#fff",
                    flexShrink: 0,
                  }}
                >
                  {previewLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewLogo} alt="Forhåndsvisning av logo" style={{ maxWidth: "100%", maxHeight: "100%" }} />
                  ) : (
                    <span style={{ fontSize: "0.75rem", color: "var(--muted)", textAlign: "center", padding: 4 }}>
                      Standardlogo
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {previewLogo ? "Bytt logo" : "Last opp logo"}
                  </button>
                  {previewLogo && (
                    <button type="button" className={styles.linkButtonDanger} onClick={handleRemoveLogo}>
                      Fjern logo (bruk standard)
                    </button>
                  )}
                  {!previewLogo && removeLogo && (
                    <button type="button" className={styles.linkButton} onClick={handleUndoRemove}>
                      Angre fjerning
                    </button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={handleFileChange}
                  style={{ display: "none" }}
                />
              </div>
              <p className={styles.bookingMeta} style={{ marginTop: 6 }}>
                PNG, JPG, WebP eller SVG, maks 2 MB.
              </p>
              {fileError && <p className={styles.error}>{fileError}</p>}
            </div>

            {saveMessage && (
              <p className={saveMessage.ok ? styles.success : styles.error} style={{ marginTop: 10 }}>
                {saveMessage.text}
              </p>
            )}

            <button type="submit" className={styles.submitButton} disabled={saving} style={{ marginTop: 10 }}>
              {saving ? "Lagrer …" : "Lagre"}
            </button>
          </form>
        </div>
      )}

      {contentLoading && <p>Laster …</p>}
      {contentLoadError && <p className={styles.error}>{contentLoadError}</p>}

      {!contentLoading && !contentLoadError && (
        <div className={styles.card}>
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Tekster på bookingsiden</h2>
          <p className={styles.bookingMeta}>
            De to korte tekstene som vises øverst og nederst på selve bookingsiden. Du kan gjøre tekst fet, kursiv
            eller understreket, og legge til lenker.
          </p>

          <div className={styles.formRow}>
            <label>Medlemskapsnotis (vises rett over kalenderen)</label>
            <RichTextEditor
              value={membershipNoticeHtml}
              onChange={setMembershipNoticeHtml}
              resetToken={noticeResetToken}
              disabled={savingNotice}
            />
            {noticeMessage && (
              <p className={noticeMessage.ok ? styles.success : styles.error} style={{ marginTop: 6 }}>
                {noticeMessage.text}
              </p>
            )}
            <div style={{ display: "flex", gap: "8px", marginTop: 8 }}>
              <button type="button" className={styles.submitButton} disabled={savingNotice} onClick={handleSaveNotice}>
                {savingNotice ? "Lagrer …" : "Lagre"}
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={savingNotice}
                onClick={handleResetNotice}
              >
                Tilbakestill til standard
              </button>
            </div>
          </div>

          <div className={styles.formRow} style={{ marginTop: 20 }}>
            <label>Bunntekst (vises nederst på siden)</label>
            <RichTextEditor
              value={footerHtml}
              onChange={setFooterHtml}
              resetToken={footerResetToken}
              disabled={savingFooter}
            />
            {footerMessage && (
              <p className={footerMessage.ok ? styles.success : styles.error} style={{ marginTop: 6 }}>
                {footerMessage.text}
              </p>
            )}
            <div style={{ display: "flex", gap: "8px", marginTop: 8 }}>
              <button type="button" className={styles.submitButton} disabled={savingFooter} onClick={handleSaveFooter}>
                {savingFooter ? "Lagrer …" : "Lagre"}
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={savingFooter}
                onClick={handleResetFooter}
              >
                Tilbakestill til standard
              </button>
            </div>
          </div>
        </div>
      )}
        </div>
      </main>
    </>
  );
}
