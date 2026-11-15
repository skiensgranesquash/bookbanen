-- Ytelsesfiks: et vanlig B-tre-indeks som faktisk støtter spørringen
-- findConflictsImpl (lib/db/supabase.ts) kjører på HVERT ENESTE kall til
-- "hent ledige tider" (court_id = ? AND blocks_time = true AND
-- start_time < ? AND end_time > ?). EXCLUDE-constraint-en fra
-- 0001_init.sql bruker GiST og dekker overlapp-operatoren (&&) for å HINDRE
-- dobbeltbooking, men Postgres kan IKKE bruke den til å svare på denne
-- spørringen, som sjekker start_time og end_time som to uavhengige
-- skalar-sammenligninger – uten denne hjelper ingen av de eksisterende
-- indeksene, og Postgres må lese gjennom HELE booking_slots-tabellen for
-- hvert eneste kall, noe som har blitt tregere og tregere etter hvert som
-- historikken har vokst.
create index if not exists booking_slots_conflict_check_idx
  on booking_slots (court_id, blocks_time, start_time, end_time);
