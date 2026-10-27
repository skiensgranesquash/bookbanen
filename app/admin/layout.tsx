import type { Metadata } from "next";
import type { ReactNode } from "react";

/** Hindrer at adminpanelet (innlogging, oversikt, innstillinger) dukker opp i søkeresultater. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
