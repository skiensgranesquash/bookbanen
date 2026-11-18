import { redirect } from "next/navigation";

/**
 * "/admin/koder" i seg selv har ikke noe eget innhold – Koder-fanen (se
 * AdminNav.tsx) peker hit, og siden videresender rett til Turneringer-
 * underfanen (se koder/turneringer/page.tsx), som er den vi viser som
 * standard.
 */
export default function AdminKoderPage() {
  redirect("/admin/koder/turneringer");
}
