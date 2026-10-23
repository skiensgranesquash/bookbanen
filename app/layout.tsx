import type { ReactNode } from "react";

export const metadata = {
  title: "IF Skiens Grane – Squashbooking",
};

/**
 * Root layout for produksjon (bookbanen.no). Bruker klubbens egen font
 * (DM Sans) og fargepalett (marineblå/gul, hentet direkte fra
 * skiensgrane.no).
 *
 * NB: DM Sans lastes her med en vanlig <link>-tag (slik de fleste nettsider
 * gjør det) i stedet for next/font/google. next/font/google laster ned
 * skrifttypen mens DEV-SERVEREN starter opp, og hvis den maskinen sitter bak
 * en brannmur/VPN som blokkerer Google sine fontservere, kan det gjøre at
 * "npm run dev" henger seg helt opp uten noen feilmelding. Med <link> er det
 * i stedet nettleseren (ikke serveren) som henter fonten, akkurat som på en
 * vanlig nettside – det kan aldri blokkere oppstarten av appen.
 *
 * Stripen under var opprinnelig en midlertidig "vi tester dette"-bjelke fra
 * da dette kjørte som en lokal testversjon ment for å flyttes inn i
 * skiensgrane.no-prosjektet. Planen endret seg underveis: bookbanen.no er nå
 * sin egen, selvstendige produksjonsside – stripen er derfor beholdt som en
 * enkel merkevare-header (logo + klubbnavn), men "testes lokalt"-teksten er
 * fjernet siden den ikke lenger stemmer.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="no">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        style={{
          margin: 0,
          background: "#f9fafb",
          color: "#111827",
          fontFamily: "'DM Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div
          style={{
            background: "#ffffff",
            borderBottom: "3px solid #f8dc3c",
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "999px",
                background: "#0046b3",
                color: "#f8dc3c",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: "0.75rem",
                flexShrink: 0,
              }}
            >
              IG
            </div>
            <span style={{ fontWeight: 700, color: "#0046b3", fontSize: "0.95rem" }}>IF Skiens Grane Squash</span>
          </div>
        </div>
        {children}
      </body>
    </html>
  );
}
