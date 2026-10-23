-- Gir service_role (den eneste rollen appen noensinne bruker, se
-- lib/db/supabaseClient.ts) faktisk databasetilgang til tabellene.
--
-- Når tabeller opprettes direkte via SQL Editor (slik 0001/0002 gjorde),
-- dekkes de IKKE automatisk av prosjektets "ALTER DEFAULT PRIVILEGES" for
-- public-skjemaet på samme måte som tabeller opprettet via dashbordets
-- tabellredigering. Uten disse GRANT-setningene svarer Postgres med
-- "permission denied for table ..." FØR RLS-politikken i det hele tatt
-- vurderes (RLS enablet uten policies, som vi satte opp i 0001, stenger
-- fortsatt anon/authenticated ute helt uavhengig av dette – de får bevisst
-- INGEN grants her, kun service_role).
grant usage on schema public to service_role;

grant select, insert, update, delete on table booking_groups to service_role;
grant select, insert, update, delete on table booking_slots  to service_role;
grant select, insert, update, delete on table admin_users    to service_role;
grant select, insert, update, delete on table app_settings   to service_role;
