-- Legger til "role"-kolonnen på admin_users: skiller en vanlig ("full")
-- administrator som kan gjøre alt i adminpanelet fra en begrenset
-- ("bookings_only") administrator som kun får administrere Bookinger-fanen
-- (håndheves sentralt i middleware.ts, se BOOKINGS_ONLY_ALLOWED_* der, og
-- i AdminNav.tsx som skjuler de andre fanene for en slik bruker).
--
-- DEFAULT 'full' gjør dette trygt å kjøre mot en database som allerede har
-- admin-brukere: alle eksisterende administratorer forblir fulle
-- administratorer, akkurat som de alltid har vært.
alter table admin_users
  add column if not exists role text not null default 'full'
  check (role in ('full', 'bookings_only'));
