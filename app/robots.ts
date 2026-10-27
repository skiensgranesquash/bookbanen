import type { MetadataRoute } from "next";

/**
 * Fil-basert robots.txt – Next.js genererer /robots.txt automatisk fra denne
 * filen (App Router-konvensjon). Adminpanelet og API-rutene skal ALDRI
 * indekseres av søkemotorer – det er kun selve bookingsiden ("/") som skal
 * kunne dukke opp i søk.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api"],
      },
    ],
    sitemap: "https://bookbanen.no/sitemap.xml",
  };
}
