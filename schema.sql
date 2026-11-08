-- Paragon: database schema
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste everything -> Run.
-- Safe to run again: it only creates what is missing.

-- 1. Settings per user (currency, learned name corrections)
create table if not exists public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  currency    text not null default 'EUR',
  aliases     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- 2. Receipts and manual expenses. Line items are stored as JSON:
--    [{name, product, category, qty, unit, unitPrice, price}, ...]
create table if not exists public.receipts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date           date not null,
  store          text not null default '',
  items          jsonb not null default '[]'::jsonb,
  source         text not null default 'manual' check (source in ('scan', 'manual')),
  printed_total  numeric,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists receipts_user_date on public.receipts (user_id, date);

-- 3. Scan counter per user per month (protects your AI costs)
create table if not exists public.scan_usage (
  user_id  uuid not null references auth.users (id) on delete cascade,
  month    text not null,              -- 'YYYY-MM'
  count    integer not null default 0,
  primary key (user_id, month)
);

-- Row Level Security: every user sees and changes only their own rows.
alter table public.profiles   enable row level security;
alter table public.receipts   enable row level security;
alter table public.scan_usage enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own receipts" on public.receipts;
create policy "own receipts" on public.receipts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Users may only READ their scan counter. Only the server function changes it.
drop policy if exists "read own usage" on public.scan_usage;
create policy "read own usage" on public.scan_usage
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Counts one scan if the user is under the limit. Returns the new count, or -1 when the limit is reached.
create or replace function public.use_scan(p_user uuid, p_month text, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c integer;
begin
  insert into public.scan_usage (user_id, month, count)
  values (p_user, p_month, 1)
  on conflict (user_id, month) do update
    set count = public.scan_usage.count + 1
    where public.scan_usage.count < p_limit
  returning public.scan_usage.count into c;
  if c is null or c > p_limit then
    return -1;
  end if;
  return c;
end;
$$;

-- Gives a scan back when the AI call failed, so users don't pay for errors.
create or replace function public.refund_scan(p_user uuid, p_month text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.scan_usage
     set count = greatest(count - 1, 0)
   where user_id = p_user and month = p_month;
$$;

-- Only the server (service role) may call these two functions.
revoke all on function public.use_scan(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.refund_scan(uuid, text) from public, anon, authenticated;
grant execute on function public.use_scan(uuid, text, integer) to service_role;
grant execute on function public.refund_scan(uuid, text) to service_role;
