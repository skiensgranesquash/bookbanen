import type { MetadataRoute } from "next";

/**
 * Fil-basert sitemap.xml – Next.js genererer /sitemap.xml automatisk fra
 * denne filen (App Router-konvensjon). Siden har egentlig bare én offentlig
 * side ("/"), så sitemapet er bevisst holdt enkelt.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://bookbanen.no",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
