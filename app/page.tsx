import { redirect } from "next/navigation";

/**
 * Appen har foreløpig bare én klubb/bane (se lib/config.ts), så "/" sender
 * besøkende rett til bookingsiden i stedet for å vise en 404 – dette er
 * spesielt viktig når folk skriver inn bookbanen.no direkte i nettleseren.
 * Skulle appen senere støtte flere klubber, er dette det naturlige stedet å
 * bytte ut med en klubbvelger.
 */
export default function RootPage() {
  redirect("/squash/booking");
}
