-- ScaleMatrix AI dashboard setup. Run this complete file once in Supabase SQL Editor.

-- Run once in your own Supabase project's SQL Editor.
-- Server-only, single-owner workspace. No browser access to these tables.
create table if not exists public.sm_settings (
  id text primary key default 'default',
  value jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists public.sm_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  kind text not null check (kind in ('daily','content','prospects')),
  run_date date not null,
  status text not null default 'running' check (status in ('running','completed','failed')),
  summary text not null default '',
  created_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create table if not exists public.sm_posts (
  id uuid primary key default gen_random_uuid(),
  generation_date date not null,
  platform text not null check (platform in ('linkedin','twitter')),
  title text not null,
  body text not null check ((platform = 'twitter' and char_length(body) <= 280) or (platform = 'linkedin' and char_length(body) <= 3000)),
  topic text not null,
  rationale text not null default '',
  visual_brief text not null default '',
  sources jsonb not null default '[]',
  status text not null default 'draft' check (status in ('draft','approved','posted','archived')),
  run_id uuid references public.sm_runs(id),
  created_at timestamptz not null default now(),
  unique (generation_date, platform)
);
create table if not exists public.sm_prospects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website text not null,
  website_key text not null unique,
  industry text not null,
  location text not null,
  opportunity text not null,
  evidence text not null,
  source_url text not null,
  contact_url text,
  outreach_draft text not null default '',
  notes text not null default '',
  stage text not null default 'new' check (stage in ('new','shortlisted','contacted','qualified','archived')),
  researched_at timestamptz not null default now(),
  run_id uuid references public.sm_runs(id),
  created_at timestamptz not null default now()
);
create index if not exists sm_posts_date_idx on public.sm_posts(generation_date desc);
create index if not exists sm_prospects_stage_idx on public.sm_prospects(stage);
create index if not exists sm_runs_date_idx on public.sm_runs(run_date desc);

alter table public.sm_settings enable row level security;
alter table public.sm_runs enable row level security;
alter table public.sm_posts enable row level security;
alter table public.sm_prospects enable row level security;
revoke all on public.sm_settings, public.sm_runs, public.sm_posts, public.sm_prospects from anon, authenticated;
grant select, insert, update, delete on public.sm_settings, public.sm_runs, public.sm_posts, public.sm_prospects to service_role;

-- Claim once across restarts or workers. Only failed or expired jobs can be retried.
create or replace function public.sm_claim_run(p_key text, p_kind text, p_date date)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare claimed public.sm_runs;
begin
  insert into public.sm_runs(run_key, kind, run_date)
  values (p_key, p_kind, p_date)
  on conflict (run_key) do update
    set status = 'running', started_at = now(), finished_at = null, summary = ''
    where sm_runs.status = 'failed'
      or (sm_runs.status = 'running' and sm_runs.started_at < now() - interval '20 minutes')
  returning * into claimed;
  if claimed.id is null then return null; end if;
  return to_jsonb(claimed);
end;
$$;
revoke all on function public.sm_claim_run(text, text, date) from public, anon, authenticated;
grant execute on function public.sm_claim_run(text, text, date) to service_role;


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


-- Make new tables and RPCs visible to the Data API immediately.
notify pgrst, 'reload schema';
