-- "Pójdziesz do tego sklepu, czy nie" — schemat
-- Aplikacja dla dokładnie dwóch osób (tabela app_members, maks. 2 wpisy).

create extension if not exists pg_trgm with schema extensions;

-- ===== Członkowie =====
-- Projekt Supabase jest współdzielony z inną aplikacją, więc NIE ruszamy auth.users.
-- Członkiem tej aplikacji zostają maksymalnie 2 konta (przez join_app()).
create table public.app_members (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_members where id = auth.uid());
$$;

create or replace function public.join_app(p_display_name text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Niezalogowany'; end if;
  if exists (select 1 from public.app_members where id = auth.uid()) then return true; end if;
  lock table public.app_members in exclusive mode;
  if (select count(*) from public.app_members) >= 2 then
    raise exception 'Ta aplikacja jest tylko dla dwóch osób.';
  end if;
  insert into public.app_members (id, email, display_name)
  select u.id, u.email, coalesce(p_display_name, u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1))
  from auth.users u where u.id = auth.uid();
  return true;
end $$;
revoke all on function public.join_app(text) from public, anon;
grant execute on function public.join_app(text) to authenticated;

-- ===== Listy zakupów =====
create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft' check (status in ('draft','optimized','done')),
  summary jsonb,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  optimized_at timestamptz
);

create table public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shopping_lists(id) on delete cascade,
  name text not null,
  quantity numeric not null default 1,
  unit text default 'szt',
  note text,
  checked boolean not null default false,
  position int not null default 0,
  -- wynik optymalizacji
  assigned_store text check (assigned_store in ('lidl','biedronka','aldi')),
  best_price numeric,
  regular_price numeric,
  promo_id uuid,
  promo_label text,
  ai_note text,
  alternatives jsonb,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.list_items(list_id);

-- ===== Promocje (gazetki + kupony) =====
create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  store text not null check (store in ('lidl','biedronka','aldi')),
  product_name text not null,
  brand text,
  price numeric not null,
  regular_price numeric,
  unit text,
  conditions text,
  valid_from date,
  valid_to date,
  source text not null default 'gazetka' check (source in ('gazetka','kupon','reczna')),
  source_url text,
  image_path text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on public.promotions(store, valid_to);
create index promotions_name_trgm on public.promotions using gin (product_name extensions.gin_trgm_ops);

-- ===== Paragony =====
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  store text,
  purchase_date date,
  total numeric,
  total_discount numeric default 0,
  image_path text,
  status text not null default 'processing' check (status in ('processing','done','error')),
  error text,
  list_id uuid references public.shopping_lists(id) on delete set null,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  raw_name text not null,
  product_name text not null,
  category text,
  quantity numeric not null default 1,
  unit text,
  unit_price numeric,
  total_price numeric not null,
  discount numeric not null default 0
);
create index on public.receipt_items(receipt_id);
create index on public.receipt_items(product_name);

-- ===== Zadania AI (asynchroniczne) =====
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  status text not null default 'running' check (status in ('running','done','error')),
  progress text,
  input jsonb,
  result jsonb,
  error text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== RLS: wszystko wspólne dla dwóch członków =====
do $$
declare t text;
begin
  foreach t in array array['shopping_lists','list_items','promotions','receipts','receipt_items','jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members_all" on public.%I for all to authenticated using (public.is_member()) with check (public.is_member())', t);
  end loop;
end $$;

alter table public.app_members enable row level security;
create policy "members_read" on public.app_members for select to authenticated using (public.is_member());

-- ===== Realtime (wspólna lista na żywo) =====
alter publication supabase_realtime add table public.list_items, public.shopping_lists, public.jobs, public.receipts;

-- ===== Storage =====
insert into storage.buckets (id, name, public) values ('pojdziesz', 'pojdziesz', false)
on conflict (id) do nothing;

create policy "pojdziesz_read" on storage.objects for select to authenticated
  using (bucket_id = 'pojdziesz' and public.is_member());
create policy "pojdziesz_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'pojdziesz' and public.is_member());
create policy "pojdziesz_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'pojdziesz' and public.is_member());

-- ===== Statystyki =====
-- Przepłata: cena jednostkowa z paragonu vs najniższa znana cena tego produktu
-- (promocje + inne paragony) w oknie ±7 dni od zakupu.
create or replace view public.v_receipt_item_stats with (security_invoker = true) as
with base as (
  select ri.*, r.store, r.purchase_date,
         coalesce(ri.unit_price, ri.total_price / nullif(ri.quantity, 0)) as eff_unit_price
  from public.receipt_items ri join public.receipts r on r.id = ri.receipt_id
  where r.status = 'done'
),
best as (
  select b.id,
    least(
      (select min(p.price) from public.promotions p
        where extensions.similarity(lower(p.product_name), lower(b.product_name)) > 0.45
          and (p.valid_from is null or p.valid_from <= b.purchase_date + 7)
          and (p.valid_to is null or p.valid_to >= b.purchase_date - 7)),
      (select min(coalesce(o.unit_price, o.total_price / nullif(o.quantity,0)))
         from base o
        where o.product_name = b.product_name and o.id <> b.id
          and o.purchase_date between b.purchase_date - 7 and b.purchase_date + 7)
    ) as best_known_price
  from base b
)
select b.*, best.best_known_price,
  greatest(0, (b.eff_unit_price - best.best_known_price)) * b.quantity as overpaid
from base b join best on best.id = b.id;

create or replace view public.v_monthly_stats with (security_invoker = true) as
select date_trunc('month', r.purchase_date)::date as month,
       r.store,
       sum(r.total) as spent,
       sum(r.total_discount) as saved_discounts,
       count(*) as receipts
from public.receipts r where r.status = 'done'
group by 1, 2;

create or replace view public.v_price_history with (security_invoker = true) as
select ri.product_name, r.store, r.purchase_date as date,
       coalesce(ri.unit_price, ri.total_price / nullif(ri.quantity,0)) as price, 'paragon'::text as source
from public.receipt_items ri join public.receipts r on r.id = ri.receipt_id where r.status = 'done'
union all
select p.product_name, p.store, coalesce(p.valid_from, p.created_at::date), p.price, p.source
from public.promotions p;
