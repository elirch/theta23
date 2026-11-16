-- Theta23 — Space Mission Readiness Radar · Phase 1 schema
--
-- Everything lives in the dedicated schema `theta23_space`. This migration
-- does not read, alter or drop anything in `public` or any other schema, so
-- the tables of the retired financial application are left untouched.
-- It is idempotent: running it twice is safe.

create schema if not exists theta23_space;

create table if not exists theta23_space.missions (
  id            text primary key,
  name          text not null,
  description   text not null default '',
  analysis_date date not null
);

create table if not exists theta23_space.locations (
  id        text primary key,
  code      text not null unique,
  name      text not null,
  city      text not null,
  country   text not null,
  latitude  double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  type      text not null check (type in ('supplier','transit_hub','integration_facility','test_facility','launch_site'))
);

create table if not exists theta23_space.routes (
  id   text primary key,
  code text not null unique,
  name text not null
);

create table if not exists theta23_space.route_stops (
  route_id    text not null references theta23_space.routes(id) on delete cascade,
  position    integer not null check (position >= 0),
  location_id text not null references theta23_space.locations(id),
  primary key (route_id, position)
);

create table if not exists theta23_space.milestones (
  id                      text primary key,
  mission_id              text not null references theta23_space.missions(id) on delete cascade,
  code                    text not null,
  name                    text not null,
  type                    text not null check (type in ('review','test_campaign','integration_cutoff')),
  scheduled_date          date not null,
  sequence                integer not null,
  min_days_after_previous integer check (min_days_after_previous >= 0),
  alternative_date        date,
  unique (mission_id, code),
  unique (mission_id, sequence)
);

create table if not exists theta23_space.components (
  id                    text primary key,
  mission_id            text not null references theta23_space.missions(id) on delete cascade,
  part_number           text not null,
  description           text not null,
  subsystem             text not null,
  supplier_name         text not null,
  supplier_location_id  text not null references theta23_space.locations(id),
  route_id              text references theta23_space.routes(id),
  milestone_id          text references theta23_space.milestones(id),
  baseline_arrival_date date,
  preparation_days      integer check (preparation_days >= 0),
  is_single_source      boolean not null default false,
  notes                 text not null default '',
  created_at            timestamptz not null default now()
);

create unique index if not exists components_mission_part_number_key
  on theta23_space.components (mission_id, lower(part_number));

create table if not exists theta23_space.scenarios (
  id          text primary key,
  name        text not null,
  description text not null default '',
  target_type text not null check (target_type in ('supplier_location','route')),
  target_id   text not null,
  delay_days  integer not null check (delay_days >= 0),
  position    integer not null default 0
);

create table if not exists theta23_space.action_records (
  id           text primary key,
  component_id text not null references theta23_space.components(id) on delete cascade,
  action_type  text not null check (action_type in ('contact_supplier','investigate_alternate_source','investigate_alternate_transport','confirm_alternative_test_slot','accept_and_monitor')),
  owner        text not null,
  status       text not null default 'open' check (status in ('open','in_progress','closed')),
  note         text not null default '',
  created_at   timestamptz not null default now()
);

-- Access: the application reaches these tables only from the server through a
-- direct PostgreSQL connection. The Supabase Data API roles get nothing, and
-- row-level security is enabled with no policies as a second barrier in case
-- the schema is ever exposed through the Data API.
alter table theta23_space.missions       enable row level security;
alter table theta23_space.locations      enable row level security;
alter table theta23_space.routes         enable row level security;
alter table theta23_space.route_stops    enable row level security;
alter table theta23_space.milestones     enable row level security;
alter table theta23_space.components     enable row level security;
alter table theta23_space.scenarios      enable row level security;
alter table theta23_space.action_records enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema theta23_space from %I', r);
      execute format('revoke all on all tables in schema theta23_space from %I', r);
    end if;
  end loop;
end
$$;
