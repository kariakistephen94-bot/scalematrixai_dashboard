-- Run after 001_workspace.sql. Retains stable Google Place IDs and your own workflow data.
-- Business names, addresses, phone numbers, and website details are fetched live, not cached here.
create table if not exists public.sm_maps_leads (
  id uuid primary key default gen_random_uuid(),
  place_id text not null unique check (length(place_id) between 1 and 255),
  niche text not null,
  country text not null,
  search_city text not null,
  stage text not null default 'new' check (stage in ('new','shortlisted','contacted','qualified','archived')),
  notes text not null default '',
  run_id uuid references public.sm_runs(id),
  created_at timestamptz not null default now()
);
create index if not exists sm_maps_leads_stage_idx on public.sm_maps_leads(stage);
alter table public.sm_maps_leads enable row level security;
revoke all on public.sm_maps_leads from anon, authenticated;
grant select, insert, update, delete on public.sm_maps_leads to service_role;
