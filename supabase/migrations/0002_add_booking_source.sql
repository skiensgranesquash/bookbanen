-- Legger til "source"-kolonnen på booking_groups: skiller en vanlig
-- kundebooking (gjort via den offentlige bookingsiden, med ekte/simulert
-- Vipps-betaling) fra en booking admin har opprettet direkte (f.eks. "Book
-- uten betaling", eller en blokkering av banen). Brukes til å vise et
-- "Manuelt"-merke i adminpanelets "Siste bookinger" (se
-- app/admin/AdminDashboard.tsx og lib/db/types.ts sin BookingSource).
--
-- DEFAULT 'customer' gjør dette trygt å kjøre mot en database som allerede
-- har rader: alle eksisterende bookinger regnes som vanlige kundebookinger
-- (riktig for alt unntatt gamle admin-opprettede bookinger/blokkeringer, som
-- uansett ikke kunne skilles fra en vanlig booking før denne kolonnen fantes).
alter table booking_groups
  add column if not exists source text not null default 'customer'
  check (source in ('customer', 'admin'));
