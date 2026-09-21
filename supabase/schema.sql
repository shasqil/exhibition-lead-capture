-- Exhibition Lead Capture — database setup.
--
-- Paste this whole file into the Supabase SQL editor and press Run.
-- It is safe to run more than once.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  location    text not null default '',
  starts_on   date,
  ends_on     date,
  created_at  timestamptz not null default now()
);

create table if not exists public.leads (
  -- Generated on the phone so a lead captured with no signal keeps its
  -- identity, and re-sending it later can never create a duplicate.
  id                 uuid primary key,
  event_id           uuid references public.events(id) on delete set null,
  -- Kept alongside event_id so an export still names the show even if the
  -- event row is later renamed or removed.
  event_name         text,
  captured_by        text not null default '',
  captured_at        timestamptz not null default now(),
  rating             text not null default 'warm'
                     check (rating in ('hot', 'warm', 'cold', 'not_a_lead')),

  full_name          text not null default '',
  job_title          text not null default '',
  company            text not null default '',
  email              text not null default '',
  phone              text not null default '',
  mobile             text not null default '',
  website            text not null default '',
  address            text not null default '',
  country            text not null default '',

  products_discussed text not null default '',
  notes              text not null default '',
  follow_up          text not null default '',
  follow_up_by       date,

  card_front_url     text,
  card_back_url      text,

  updated_at         timestamptz not null default now(),
  -- Soft delete, so a removal made on one phone reaches the others.
  deleted            boolean not null default false
);

create index if not exists leads_updated_at_idx on public.leads (updated_at);
create index if not exists leads_event_id_idx   on public.leads (event_id);

-- ---------------------------------------------------------------------------
-- Lock the tables down
--
-- The app never talks to Supabase from the browser. Every read and write goes
-- through this project's own API routes, which hold the service role key and
-- check the team passcode first. Enabling RLS with no policies means a leaked
-- anon key grants nothing at all.
-- ---------------------------------------------------------------------------

alter table public.leads  enable row level security;
alter table public.events enable row level security;

-- ---------------------------------------------------------------------------
-- Conditional upsert
--
-- Two phones can edit the same lead while both are offline. Whichever edit was
-- made later wins; an older copy arriving afterwards is ignored rather than
-- overwriting the newer one.
-- ---------------------------------------------------------------------------

create or replace function public.upsert_leads(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  insert into public.leads as l (
    id, event_id, event_name, captured_by, captured_at, rating,
    full_name, job_title, company, email, phone, mobile, website, address, country,
    products_discussed, notes, follow_up, follow_up_by,
    card_front_url, card_back_url, updated_at, deleted
  )
  select
    x.id, x.event_id, x.event_name, x.captured_by, x.captured_at, x.rating,
    x.full_name, x.job_title, x.company, x.email, x.phone, x.mobile, x.website,
    x.address, x.country,
    x.products_discussed, x.notes, x.follow_up, x.follow_up_by,
    x.card_front_url, x.card_back_url, x.updated_at, x.deleted
  from jsonb_to_recordset(payload) as x(
    id uuid, event_id uuid, event_name text, captured_by text,
    captured_at timestamptz, rating text,
    full_name text, job_title text, company text, email text, phone text,
    mobile text, website text, address text, country text,
    products_discussed text, notes text, follow_up text, follow_up_by date,
    card_front_url text, card_back_url text, updated_at timestamptz, deleted boolean
  )
  on conflict (id) do update set
    event_id           = excluded.event_id,
    event_name         = excluded.event_name,
    captured_by        = excluded.captured_by,
    captured_at        = excluded.captured_at,
    rating             = excluded.rating,
    full_name          = excluded.full_name,
    job_title          = excluded.job_title,
    company            = excluded.company,
    email              = excluded.email,
    phone              = excluded.phone,
    mobile             = excluded.mobile,
    website            = excluded.website,
    address            = excluded.address,
    country            = excluded.country,
    products_discussed = excluded.products_discussed,
    notes              = excluded.notes,
    follow_up          = excluded.follow_up,
    follow_up_by       = excluded.follow_up_by,
    -- A photo URL is only ever added, never cleared, so a phone that synced
    -- the text before the image cannot wipe a URL another phone uploaded.
    card_front_url     = coalesce(excluded.card_front_url, l.card_front_url),
    card_back_url      = coalesce(excluded.card_back_url, l.card_back_url),
    updated_at         = excluded.updated_at,
    deleted            = excluded.deleted
  where excluded.updated_at > l.updated_at;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage bucket for the card photos
--
-- Public, so the photo links in the exported spreadsheet open for anyone you
-- send the file to. Each path contains a random UUID, so the links cannot be
-- guessed, but treat them as "anyone with the link can view" — see the note in
-- README.md if you would rather they expire.
--
-- Deliberately last, and guarded. On some projects the SQL editor's role
-- cannot write to storage.buckets, and an error here would abort the whole
-- script — leaving the tables in place but no upsert_leads function, which
-- fails later in a way that is hard to connect back to this line. A refusal
-- now just prints a notice telling you to make the bucket by hand.
-- ---------------------------------------------------------------------------

do $$
begin
  insert into storage.buckets (id, name, public)
  values ('cards', 'cards', true)
  on conflict (id) do update set public = true;
exception
  when insufficient_privilege or undefined_table then
    raise notice 'Could not create the "cards" bucket from SQL. Make it by hand: Supabase -> Storage -> New bucket -> name it exactly "cards" and tick Public.';
end
$$;
