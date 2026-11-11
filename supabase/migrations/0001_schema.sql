-- Neksus Dine: database schema (one restaurant per Supabase project).
-- All money is stored as integer cents. Run the migrations in order in the Supabase SQL editor,
-- or with the Supabase CLI: supabase db push

create sequence if not exists order_number_seq start 1;
create sequence if not exists tab_number_seq start 1;

-- ---------- restaurant settings (a single row) ----------
create table settings (
  id int primary key default 1 check (id = 1),
  name text not null default 'My Restaurant',
  open_text text not null default '',
  currency text not null default '$' check (char_length(currency) between 1 and 3),
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  service_rate numeric(5,2) not null default 0 check (service_rate between 0 and 100),
  ordering_open boolean not null default true,
  customer_requests boolean not null default true,
  block_out_of_stock boolean not null default true,
  public_url text not null default '',
  waiter_can_void boolean not null default true,
  waiter_max_discount numeric(5,2) not null default 10 check (waiter_max_discount between 0 and 100),
  business_address text not null default '',
  business_phone text not null default '',
  tax_id text not null default '',
  receipt_header text not null default '',
  receipt_footer text not null default 'Thank you for dining with us!',
  paper_width int not null default 80 check (paper_width in (58, 80)),
  receipt_copies int not null default 1 check (receipt_copies between 1 and 5),
  kitchen_auto_print boolean not null default false,
  kitchen_split_stations boolean not null default false
);
insert into settings (id) values (1);

-- ---------- menu ----------
create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 30),
  position int not null default 0
);

create table ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 50),
  unit text not null default 'pcs' check (unit in ('pcs', 'kg', 'g', 'l', 'ml', 'portion')),
  on_hand numeric(12,3) not null default 0,
  low_at numeric(12,3) not null default 0 check (low_at >= 0)
);

create table items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '',
  price int not null check (price >= 0),
  category_id uuid not null references categories (id) on delete restrict,
  station text not null default 'kitchen' check (station in ('grill', 'kitchen', 'cold')),
  popular boolean not null default false,
  available boolean not null default true,
  extras jsonb not null default '[]'   -- [{ "name": "Extra cheese", "price": 150 }]
);

create table recipe_lines (
  item_id uuid not null references items (id) on delete cascade,
  ingredient_id uuid not null references ingredients (id) on delete restrict,
  qty numeric(12,3) not null check (qty > 0),
  primary key (item_id, ingredient_id)
);

create table dining_tables (
  id text primary key check (id ~ '^[a-z0-9-]+$'),
  label text not null unique check (char_length(label) between 1 and 30),
  created_at timestamptz not null default now()
);
insert into dining_tables (id, label) values ('takeaway', 'Takeaway');

-- ---------- bills (tabs), orders, payments ----------
create table tabs (
  id uuid primary key default gen_random_uuid(),
  number int not null unique default nextval('tab_number_seq'),
  table_id text not null,
  table_label text not null,
  status text not null default 'open' check (status in ('open', 'bill', 'paid', 'void')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  waiter text,
  tax_rate numeric(5,2) not null,
  service_rate numeric(5,2) not null,
  discount_type text check (discount_type in ('percent', 'amount')),
  discount_value numeric(12,2),
  discount_reason text,
  discount_by text
);
-- A table can only have one open bill at a time (takeaway orders each get their own).
create unique index one_open_tab_per_table on tabs (table_id)
  where status in ('open', 'bill') and table_id <> 'takeaway';
create index tabs_status_idx on tabs (status);
create index tabs_closed_idx on tabs (closed_at);

create table payments (
  id uuid primary key default gen_random_uuid(),
  tab_id uuid not null references tabs (id) on delete cascade,
  method text not null check (method in ('cash', 'card', 'other')),
  amount int not null check (amount > 0),
  created_at timestamptz not null default now(),
  by_name text
);
create index payments_tab_idx on payments (tab_id);
create index payments_created_idx on payments (created_at);

create table orders (
  id uuid primary key default gen_random_uuid(),
  number int not null unique default nextval('order_number_seq'),
  tab_id uuid not null references tabs (id) on delete cascade,
  table_id text not null,
  table_label text not null,
  source text not null check (source in ('customer', 'waiter')),
  placed_by text,
  note text not null default '',
  status text not null default 'new' check (status in ('new', 'preparing', 'ready', 'served', 'cancelled')),
  subtotal int not null,
  tax int not null,
  service int not null,
  total int not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ready_at timestamptz,
  served_at timestamptz,
  cancelled_at timestamptz,
  restocked boolean not null default false
);
create index orders_created_idx on orders (created_at);
create index orders_tab_idx on orders (tab_id);
create index orders_status_idx on orders (status);

create table order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  idx int not null,
  item_id uuid references items (id) on delete set null,
  name text not null,
  station text not null,
  qty int not null check (qty between 1 and 50),
  unit int not null check (unit >= 0),
  extras jsonb not null default '[]',
  note text not null default '',
  voided_reason text,
  voided_by text,
  voided_at timestamptz,
  unique (order_id, idx)
);
create index order_lines_order_idx on order_lines (order_id);

-- ---------- service requests, stock history, audit log ----------
create table service_requests (
  id uuid primary key default gen_random_uuid(),
  table_id text not null,
  table_label text not null,
  type text not null check (type in ('waiter', 'bill')),
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_by text
);
create index service_requests_status_idx on service_requests (status);

create table stock_moves (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references ingredients (id) on delete cascade,
  delta numeric(12,3) not null,
  reason text not null check (reason in ('restock', 'waste', 'adjust', 'sale', 'return')),
  note text not null default '',
  order_id uuid references orders (id) on delete set null,
  by_name text,
  created_at timestamptz not null default now()
);
create index stock_moves_created_idx on stock_moves (created_at);

create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  by_name text,
  action text not null,
  detail text not null default ''
);

-- ---------- staff ----------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 40),
  role text not null check (role in ('owner', 'manager', 'waiter', 'kitchen')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Never let the last active owner be demoted or deactivated.
create function protect_last_owner() returns trigger language plpgsql as $$
begin
  if old.role = 'owner' and old.active and (new.role <> 'owner' or not new.active) then
    if not exists (select 1 from profiles where role = 'owner' and active and id <> old.id) then
      raise exception 'There must always be at least one active owner.';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_protect_last_owner before update on profiles
  for each row execute function protect_last_owner();
