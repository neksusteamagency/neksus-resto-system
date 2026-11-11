-- Neksus Dine: PIN sign-in on shared devices.
-- A manager signs a device in once with email and password and registers it. After that, staff pick
-- their name on that device and enter a PIN. The PIN check happens in the `staff-pin` Edge Function,
-- which hashes PINs and only talks to these tables with the service key. The browser never sees a
-- PIN hash or a device secret.

create table devices (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  token_hash text not null unique,          -- sha-256 of the secret kept on the device
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked boolean not null default false
);

create table staff_pins (
  staff_id uuid primary key references profiles (id) on delete cascade,
  pin_hash text not null,                   -- salted PBKDF2 hash, never the PIN itself
  failed int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table devices enable row level security;
alter table staff_pins enable row level security;

revoke all on devices, staff_pins from anon, authenticated;

-- Managers can see the registered devices and revoke them.
grant select on devices to authenticated;
grant update (revoked) on devices to authenticated;
create policy manager_read on devices for select to authenticated using (is_manager());
create policy manager_revoke on devices for update to authenticated using (is_manager()) with check (is_manager());

-- Managers can see who has a PIN (never the hash itself).
grant select (staff_id, updated_at) on staff_pins to authenticated;
create policy manager_read on staff_pins for select to authenticated using (is_manager());
