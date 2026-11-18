-- Flere turneringer (admin kan nå lage en LISTE av turneringer, se
-- app/admin/koder/turneringer/TournamentsManager.tsx) i stedet for ett delt
-- sett med innstillinger (de tre gamle "tournament*"-nøklene i
-- app_settings – de ligger fortsatt i tabellen, men brukes ikke lenger, og
-- kan fjernes manuelt om ønskelig).
create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  active boolean not null default false,
  expires_at date,
  created_at timestamptz not null default now()
);

-- Hvilken turnering en gitt booking hører til (kun satt for en
-- turneringsbooking, se opponent_name i 0006_add_tournament_fields.sql) –
-- "on delete set null" slik at en kamp ikke forsvinner fra historikken om
-- admin senere sletter selve turneringen.
alter table booking_groups
  add column if not exists tournament_id uuid references tournaments(id) on delete set null;
