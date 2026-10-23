-- Grunnoppsett for produksjonsdatabasen (Supabase/Postgres). Matcher nøyaktig
-- det lib/db/supabase.ts forventer å finne – se lib/db/types.ts for den
-- delte datamodellen og lib/db/local.ts for den lokale JSON-varianten av
-- samme logikk (brukt som fasit for hva som må replikeres her i databasen).
--
-- Rekkefølge: denne fila kjøres FØR 0002_add_booking_source.sql, som
-- etterpå legger til "source"-kolonnen på booking_groups.

-- Opprydding først, slik at denne fila trygt kan kjøres på nytt fra blanke
-- ark (f.eks. etter at en tidligere kjøring feilet midtveis, slik den første
-- kjøringen her gjorde pga. tsrange/tstzrange-feilen under) – ufarlig siden
-- ingenting er lagt inn i databasen ennå på dette tidspunktet.
drop table if exists booking_slots cascade;
drop table if exists booking_groups cascade;
drop table if exists admin_users cascade;
drop table if exists app_settings cascade;
drop function if exists touch_updated_at() cascade;
drop function if exists set_slot_blocks_time() cascade;
drop function if exists sync_slots_blocks_time() cascade;

-- btree_gist trengs for å kunne lage en EXCLUDE-constraint som kombinerer
-- vanlig likhet (court_id) med et tidsromoverlapp (tstzrange) – dette er
-- selve mekanismen som hindrer at to overlappende bookinger på samme bane
-- noensinne kan lykkes samtidig, selv ved helt samtidige forespørsler.
create extension if not exists btree_gist;

-- ============================================================================
-- booking_groups – "selve bestillingen": én betaling, én kunde, én status.
-- ============================================================================
create table booking_groups (
  id                 text primary key,
  status             text not null check (status in ('pending', 'confirmed', 'cancelled', 'expired')),
  kind               text not null check (kind in ('single', 'recurring', 'block')),
  customer_name      text not null,
  customer_phone     text not null,
  total_amount_ore   integer not null,
  payment_reference  text not null,
  hold_expires_at    timestamptz,
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Holder updated_at korrekt automatisk ved enhver endring (den lokale
-- JSON-varianten setter group.updatedAt manuelt i hver funksjon – her gjør vi
-- det samme via en trigger, siden lib/db/supabase.ts ikke selv setter denne
-- kolonnen eksplisitt noe sted).
create function touch_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger booking_groups_touch_updated_at
  before update on booking_groups
  for each row
  execute function touch_updated_at();

-- ============================================================================
-- booking_slots – de faktiske tidsrommene på banen. Én gruppe kan ha flere
-- slots (f.eks. én per uke for en gjentakende booking).
-- ============================================================================
create table booking_slots (
  id          uuid primary key default gen_random_uuid(),
  group_id    text not null references booking_groups(id) on delete cascade,
  court_id    text not null,
  start_time  timestamptz not null,
  end_time    timestamptz not null,

  -- Denormalisert flagg: speiler om EIERGRUPPENS status faktisk opptar banen
  -- (pending/confirmed) eller ikke (cancelled/expired). Holdes i synk av
  -- triggerne under – ALDRI satt direkte av applikasjonskoden (se
  -- lib/db/supabase.ts, som kun filtrerer PÅ denne kolonnen, men aldri
  -- skriver til den selv). Tilsvarer ACTIVE_STATUSES-sjekken i
  -- lib/db/local.ts, bare flyttet inn i databasen slik at EXCLUDE-
  -- constraint-en under kan håndheve overlapp uten å måtte slå opp i
  -- booking_groups for hver sjekk.
  blocks_time boolean not null default true,

  check (end_time > start_time)
);

create index booking_slots_group_id_idx on booking_slots (group_id);

-- Selve overlappbeskyttelsen: ingen to RADER med blocks_time = true kan ha
-- samme court_id og et overlappende tidsrom. Rader tilhørende
-- avlyste/utløpte grupper (blocks_time = false) er unntatt, slik at en
-- avlyst time ikke hindrer noen andre i å booke samme tid senere.
alter table booking_slots
  add constraint booking_slots_no_overlap
  exclude using gist (
    court_id with =,
    tstzrange(start_time, end_time) with &&
  )
  where (blocks_time);

-- Når en ny slot settes inn (alltid UTEN blocks_time spesifisert av
-- applikasjonskoden, se insertGroupWithSlots i lib/db/supabase.ts), arver den
-- eierguppens GJELDENDE status på innsettingstidspunktet – "pending" for en
-- vanlig kundebooking, "confirmed" for admin-opprettede bookinger/
-- blokkeringer (begge skal blokkere banen fra starten av).
create function set_slot_blocks_time() returns trigger as $$
declare
  group_status text;
begin
  select status into group_status from booking_groups where id = new.group_id;
  new.blocks_time := group_status in ('pending', 'confirmed');
  return new;
end;
$$ language plpgsql;

create trigger booking_slots_set_blocks_time
  before insert on booking_slots
  for each row
  execute function set_slot_blocks_time();

-- Når en gruppes status endres (bekreftet, avlyst, utløpt, eller aktivert på
-- nytt), oppdateres blocks_time på ALLE dens slots tilsvarende – dette er det
-- som gjør at findConflicts i lib/db/supabase.ts kan stole blindt på
-- blocks_time alene, uten selv å sjekke status på booking_groups.
create function sync_slots_blocks_time() returns trigger as $$
begin
  if new.status is distinct from old.status then
    update booking_slots
      set blocks_time = (new.status in ('pending', 'confirmed'))
      where group_id = new.id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger booking_groups_sync_slots_blocks_time
  after update on booking_groups
  for each row
  execute function sync_slots_blocks_time();

-- ============================================================================
-- admin_users – innlogging til adminpanelet.
-- ============================================================================
create table admin_users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  name           text not null,
  password_hash  text not null,
  password_salt  text not null,
  created_at     timestamptz not null default now()
);

-- ============================================================================
-- app_settings – enkel nøkkel/verdi-lagring brukt av adminpanelet
-- (f.eks. krypterte Vipps-nøkler, se lib/settings/vippsSettings.ts).
-- ============================================================================
create table app_settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

-- ============================================================================
-- Row Level Security – appen bruker UTELUKKENDE service_role-nøkkelen
-- server-side (aldri anon-nøkkelen fra nettleseren), som alltid går utenom
-- RLS uansett. RLS skrus likevel på her som et ekstra sikkerhetslag: skulle
-- anon-nøkkelen noen gang ved en feil havne et sted den ikke skal (f.eks. i
-- en miljøvariabel som lekker til klienten), er alle tabeller likevel
-- fullstendig stengt, siden ingen policies er definert.
-- ============================================================================
alter table booking_groups enable row level security;
alter table booking_slots  enable row level security;
alter table admin_users    enable row level security;
alter table app_settings   enable row level security;
