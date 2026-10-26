import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

/**
 * Ikoner for "Legg til på hjemskjermen" (iOS Safari/Chrome/Firefox – alle tre
 * bruker WebKit på iOS og leser apple-touch-icon, mens Android Chrome/Firefox
 * primært bruker web-manifestets icons-liste). Generert FRA klubbens egen
 * standardlogo (public/logo-squash.JPG) i tre faste størrelser – se
 * public/manifest.json for selve manifestet. Disse er statiske filer, IKKE
 * hentet live fra adminpanelets "Utseende"-innstilling (lib/settings/branding.ts)
 * slik logoet på selve bookingsiden er – om klubben laster opp en ny logo i
 * adminpanelet senere, må disse tre ikonfilene (public/icon-192.png,
 * public/icon-512.png, public/apple-touch-icon.png) genereres på nytt for at
 * hjemskjerm-ikonet skal følge med (spør utvikleren/Claude om dette).
 */
export const metadata: Metadata = {
  title: "IF Skiens Grane – Squashbooking",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Squashbooking",
  },
};

export const viewport: Viewport = {
  themeColor: "#0046b3",
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
