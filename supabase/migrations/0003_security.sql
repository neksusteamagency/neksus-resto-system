-- Neksus Dine: access control.
-- Customers (the anonymous role) can only call four functions: read the menu, place an order, follow
-- their own orders and call the waiter. They cannot read or write any table.
-- Staff (signed in, with an active row in `profiles`) can read the data tables (needed for realtime
-- updates) but all changes still go through the functions, which check the role.

alter table settings enable row level security;
alter table categories enable row level security;
alter table ingredients enable row level security;
alter table items enable row level security;
alter table recipe_lines enable row level security;
alter table dining_tables enable row level security;
alter table tabs enable row level security;
alter table payments enable row level security;
alter table orders enable row level security;
alter table order_lines enable row level security;
alter table service_requests enable row level security;
alter table stock_moves enable row level security;
alter table audit_log enable row level security;
alter table profiles enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select on settings, categories, ingredients, items, recipe_lines, dining_tables, tabs, payments,
  orders, order_lines, service_requests, stock_moves, profiles to authenticated;
grant select on audit_log to authenticated;
grant update (role, active, full_name) on profiles to authenticated;

create policy staff_read on settings for select to authenticated using (is_staff());
create policy staff_read on categories for select to authenticated using (is_staff());
create policy staff_read on ingredients for select to authenticated using (is_staff());
create policy staff_read on items for select to authenticated using (is_staff());
create policy staff_read on recipe_lines for select to authenticated using (is_staff());
create policy staff_read on dining_tables for select to authenticated using (is_staff());
create policy staff_read on tabs for select to authenticated using (is_staff());
create policy staff_read on payments for select to authenticated using (is_staff());
create policy staff_read on orders for select to authenticated using (is_staff());
create policy staff_read on order_lines for select to authenticated using (is_staff());
create policy staff_read on service_requests for select to authenticated using (is_staff());
create policy staff_read on stock_moves for select to authenticated using (is_staff());
create policy manager_read on audit_log for select to authenticated using (is_manager());

-- Everyone can read their own profile; managers and owners can read all; only owners change them.
create policy profile_read on profiles for select to authenticated using (id = auth.uid() or is_manager());
create policy owner_update on profiles for update to authenticated using (is_owner()) with check (is_owner());

-- Functions the public (customers) may call
grant execute on function get_public_menu(text), get_orders_by_ids(uuid[]), place_order(jsonb),
  request_service(text, text) to anon, authenticated;
-- Functions for signed-in staff (each one also checks the role inside)
grant execute on function staff_snapshot(), set_order_status(uuid, text, boolean), void_line(uuid, int, text),
  set_discount(uuid, text, numeric, text), add_payment(uuid, text, int), close_tab(uuid), move_tab(uuid, text),
  merge_tabs(uuid, uuid), resolve_request(uuid), upsert_ingredient(jsonb), delete_ingredient(uuid),
  adjust_stock(uuid, numeric, text, text), upsert_category(uuid, text), delete_category(uuid), move_category(uuid, int),
  upsert_item(jsonb), delete_item(uuid), set_item_available(uuid, boolean), add_table(text), delete_table(text),
  update_settings(jsonb) to authenticated;
-- Helpers used inside row-level-security policies
grant execute on function is_staff(), is_manager(), is_owner(), is_waiter_up() to authenticated;

-- Live updates for the staff screens (Supabase Realtime)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table orders, order_lines, tabs, payments, service_requests,
      items, ingredients, stock_moves, settings, categories, dining_tables, recipe_lines;
  end if;
end $$;
