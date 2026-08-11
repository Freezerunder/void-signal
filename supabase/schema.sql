-- Nova Games — server-side schema.
--
-- Run this once in the Supabase SQL Editor. It is written to be re-runnable:
-- every statement is guarded, so pasting it again is harmless.
--
-- The site ships a *publishable* key in public source, which is what that key
-- is for — every rule that actually matters is enforced here, by row-level
-- security and triggers, not by the client. Two things follow from that and
-- are worth stating plainly:
--
--   * Anything a policy allows, ANY visitor can do with nothing but the
--     publishable key and curl. So: scores are readable by all, writable only
--     by the signed-in owner, and never updatable or deletable by anyone.
--   * Anything the client sends that must not be forged (a display name, a
--     dev flag) is overwritten by a trigger below rather than trusted.

-- ---------------------------------------------------------------- profiles

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text not null unique,
  is_dev     boolean not null default false,
  created_at timestamptz not null default now(),
  constraint username_shape check (username ~ '^[A-Za-z0-9 _-]{3,16}$')
);

alter table public.profiles enable row level security;

drop policy if exists "profiles readable by everyone" on public.profiles;
create policy "profiles readable by everyone"
  on public.profiles for select
  using (true);

drop policy if exists "you may create only your own profile" on public.profiles;
create policy "you may create only your own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Deliberately NO update or delete policy. Profiles are insert-once: with an
-- update policy in place, a signed-in user could simply PATCH is_dev to true
-- and hand themselves the dev tools.

-- The owner rule, enforced where it cannot be bypassed: the first profile
-- ever created holds dev access and nobody after it does. security definer so
-- the existence check sees every row regardless of the caller's RLS view, and
-- the assignment ignores whatever the client sent.
create or replace function public.set_dev_on_first_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.is_dev := not exists (select 1 from public.profiles);
  return new;
end;
$$;

drop trigger if exists set_dev_on_first_profile on public.profiles;
create trigger set_dev_on_first_profile
  before insert on public.profiles
  for each row execute function public.set_dev_on_first_profile();

-- ------------------------------------------------------------------ scores

create table if not exists public.scores (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  username   text not null default '',
  game       text not null,
  score      integer not null check (score > 0),
  meta       jsonb not null default '{}'::jsonb,
  daily      boolean not null default false,
  day        date,
  created_at timestamptz not null default now(),
  constraint game_shape check (game ~ '^[a-z0-9_-]{1,32}$')
);

-- Existing installs: add the daily-challenge columns without touching data.
alter table public.scores add column if not exists daily boolean not null default false;
alter table public.scores add column if not exists day date;

-- Matches the two queries the client makes: top N for one game all-time, and
-- top N for one game on one day. Ties go to whoever got there first.
create index if not exists scores_game_rank_idx
  on public.scores (game, score desc, created_at asc);

create index if not exists scores_daily_rank_idx
  on public.scores (game, day, score desc, created_at asc)
  where daily;

-- One daily run per player per game per day. This is what makes the daily a
-- race rather than a grind: everyone gets the same board and one attempt at
-- it. Free-play scores have day = null and are not covered by this index, so
-- they stay unlimited.
create unique index if not exists scores_one_daily_per_day
  on public.scores (user_id, game, day)
  where daily;

alter table public.scores enable row level security;

drop policy if exists "scores readable by everyone" on public.scores;
create policy "scores readable by everyone"
  on public.scores for select
  using (true);

drop policy if exists "you may post only your own scores" on public.scores;
create policy "you may post only your own scores"
  on public.scores for insert
  with check (auth.uid() = user_id);

-- No update or delete policy: the board is append-only, so nobody can rewrite
-- or quietly remove a run — including their own.

-- The display name and the challenge day are both stamped from trusted
-- sources rather than taken from the request, so a hand-rolled POST can
-- neither post under someone else's name nor pick its own day.
create or replace function public.stamp_score_username()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select p.username into new.username
    from public.profiles p
   where p.id = new.user_id;

  if new.username is null then
    new.username := 'Player';
  end if;

  -- The day is stamped here rather than taken from the request, so nobody can
  -- backdate a run onto an easier board or post to tomorrow early. Free play
  -- carries no day at all.
  --
  -- Explicitly UTC rather than current_date: current_date follows the database
  -- session's TimeZone, while the client derives the day from getUTC* to pick
  -- the board. If the two ever disagreed, a player would be shown one day's
  -- board and have their run filed under another.
  if new.daily then
    new.day := (now() at time zone 'utc')::date;
  else
    new.day := null;
  end if;

  return new;
end;
$$;

drop trigger if exists stamp_score_username on public.scores;
create trigger stamp_score_username
  before insert on public.scores
  for each row execute function public.stamp_score_username();
