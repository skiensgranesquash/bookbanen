-- Turneringsfunksjon: en spiller kan booke en enkelttime med en admin-utstedt
-- kode (se lib/settings/tournament.ts) i stedet for å betale - da skriver de
-- inn hvem de møter i stedet for telefonnummer. Lagret direkte på
-- booking_groups (samme sted som customer_name/customer_phone), siden det
-- er ett ekstra, valgfritt felt på bookingen - ikke en egen tabell.
alter table booking_groups add column if not exists opponent_name text;
