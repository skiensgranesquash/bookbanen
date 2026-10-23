import type { ReactNode } from "react";

export const metadata = {
  title: "IF Skiens Grane – Squashbooking (lokal testversjon)",
};

/**
 * Root layout for TESTVERSJONEN. Bruker klubbens egen font (DM Sans) og
 * fargepalett (marineblå/gul, hentet direkte fra skiensgrane.no) slik at
 * Helge kan se og teste bookingløsningen med riktig visuelt uttrykk FØR den
 * flyttes inn i hovedprosjektet.
 *
 * NB: DM Sans lastes her med en vanlig <link>-tag (slik de fleste nettsider
 * gjør det) i stedet for next/font/google. next/font/google laster ned
 * skrifttypen mens DEV-SERVEREN starter opp, og hvis den maskinen sitter bak
 * en brannmur/VPN som blokkerer Google sine fontservere, kan det gjøre at
 * "npm run dev" henger seg helt opp uten noen feilmelding. Med <link> er det
 * i stedet nettleseren (ikke serveren) som henter fonten, akkurat som på en
 * vanlig nettside – det kan aldri blokkere oppstarten av appen.
 *
 * Selve stripen under er en tydelig markert, midlertidig "vi tester
 * dette"-bjelke – IKKE et forsøk på å kopiere klubbens ekte meny. Når
 * app/squash/booking og app/admin flyttes inn i det eksisterende
 * skiensgrane.no-prosjektet, fjernes denne fila/stripen helt – da arver
 * sidene det virkelige root-layoutet (ekte meny, footer osv.) som allerede
 * finnes der.
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
          <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
            Forhåndsvisning – testes lokalt før den legges inn på skiensgrane.no
          </span>
        </div>
        {children}
      </body>
    </html>
  );
}
