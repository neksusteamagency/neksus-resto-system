-- Neksus Dine: business rules as SQL functions.
-- The browser never writes to the data tables directly. It calls these functions, which check the
-- signed-in role, calculate prices on the server and keep bills, orders and stock consistent.
-- Every function returns jsonb: { "ok": true, ... } or { "ok": false, "error": "message" }.
-- The rules mirror src/lib/engine.js (the local demo engine), so keep the two in step.

-- ---------- helpers ----------
create function _fail(msg text) returns jsonb language sql immutable as
$$ select jsonb_build_object('ok', false, 'error', msg) $$;

create function _ms(ts timestamptz) returns bigint language sql immutable as
$$ select (extract(epoch from ts) * 1000)::bigint $$;

create function _role() returns text language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and active $$;

create function is_staff() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(_role() is not null, false) $$;
create function is_waiter_up() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(_role() in ('owner', 'manager', 'waiter'), false) $$;
create function is_manager() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(_role() in ('owner', 'manager'), false) $$;
create function is_owner() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(_role() = 'owner', false) $$;

create function _actor() returns text language sql stable security definer set search_path = public as
$$ select coalesce((select full_name from profiles where id = auth.uid() and active), 'Guest') $$;

create function _audit(p_action text, p_detail text) returns void language sql security definer set search_path = public as
$$ insert into audit_log (by_name, action, detail) values (_actor(), p_action, left(coalesce(p_detail, ''), 300)) $$;

create function _stock_out(p_item uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (
     select 1 from recipe_lines r join ingredients g on g.id = r.ingredient_id
     where r.item_id = p_item and g.on_hand < r.qty) $$;

create function _stock_move(p_ing uuid, p_delta numeric, p_reason text, p_note text, p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_delta = 0 then return; end if;
  update ingredients set on_hand = round(on_hand + p_delta, 3) where id = p_ing;
  insert into stock_moves (ingredient_id, delta, reason, note, order_id, by_name)
  values (p_ing, round(p_delta, 3), p_reason, coalesce(p_note, ''), p_order, _actor());
end $$;

-- Put an order's (non-removed) ingredients back (p_sign = 1) or take them out again (p_sign = -1).
create function _restock_order(p_order uuid, p_sign int, p_reason text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select rl.ingredient_id, sum(rl.qty * ol.qty) as q
    from order_lines ol join recipe_lines rl on rl.item_id = ol.item_id
    where ol.order_id = p_order and ol.voided_at is null
    group by rl.ingredient_id order by rl.ingredient_id
  loop
    perform _stock_move(r.ingredient_id, p_sign * r.q, p_reason, p_note, p_order);
  end loop;
end $$;

-- The bill for a tab. VAT and service are charged on the amount after the discount.
create function _tab_bill(p_tab uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t tabs; sub int; disc int := 0; net int; tx int; sv int; tot int; paid int;
begin
  select * into t from tabs where id = p_tab;
  select coalesce(sum(l.qty * l.unit), 0) into sub
  from order_lines l join orders o on o.id = l.order_id
  where o.tab_id = p_tab and o.status <> 'cancelled' and l.voided_at is null;
  if t.discount_type = 'percent' then disc := round(sub * t.discount_value / 100)::int;
  elsif t.discount_type = 'amount' then disc := least(sub, t.discount_value::int);
  end if;
  net := sub - disc;
  tx := round(net * t.tax_rate / 100)::int;
  sv := round(net * t.service_rate / 100)::int;
  tot := net + tx + sv;
  select coalesce(sum(amount), 0) into paid from payments where tab_id = p_tab;
  return jsonb_build_object('subtotal', sub, 'discount', disc, 'net', net, 'tax', tx, 'service', sv,
                            'total', tot, 'paid', paid, 'due', greatest(0, tot - paid));
end $$;

create function _void_empty_takeaway(p_tab uuid) returns void language plpgsql security definer set search_path = public as $$
declare t tabs;
begin
  select * into t from tabs where id = p_tab;
  if t.table_id = 'takeaway' and t.status in ('open', 'bill')
     and not exists (select 1 from payments where tab_id = p_tab)
     and (_tab_bill(p_tab)->>'total')::int = 0 then
    update tabs set status = 'void', closed_at = now() where id = p_tab;
  end if;
end $$;

-- ---------- JSON shapes (the same shapes the app uses) ----------
create function _settings_json() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', name, 'openText', open_text, 'currency', currency, 'taxRate', tax_rate, 'serviceRate', service_rate,
    'orderingOpen', ordering_open, 'customerRequests', customer_requests, 'blockOutOfStock', block_out_of_stock,
    'publicUrl', public_url, 'waiterCanVoid', waiter_can_void, 'waiterMaxDiscount', waiter_max_discount,
    'businessAddress', business_address, 'businessPhone', business_phone, 'taxId', tax_id,
    'receiptHeader', receipt_header, 'receiptFooter', receipt_footer, 'paperWidth', paper_width,
    'receiptCopies', receipt_copies, 'kitchenAutoPrint', kitchen_auto_print, 'kitchenSplitStations', kitchen_split_stations)
  from settings where id = 1 $$;

create function _order_json(p_id uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', o.id, 'number', o.number, 'tabId', o.tab_id, 'tableId', o.table_id, 'tableLabel', o.table_label,
    'source', o.source, 'placedBy', o.placed_by, 'note', o.note,
    'subtotal', o.subtotal, 'tax', o.tax, 'service', o.service, 'total', o.total, 'status', o.status,
    'createdAt', _ms(o.created_at), 'startedAt', _ms(o.started_at), 'readyAt', _ms(o.ready_at),
    'servedAt', _ms(o.served_at), 'cancelledAt', _ms(o.cancelled_at), 'restocked', o.restocked,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'itemId', l.item_id, 'name', l.name, 'station', l.station, 'qty', l.qty, 'unit', l.unit,
        'total', l.qty * l.unit, 'extras', l.extras, 'note', l.note,
        'voided', case when l.voided_at is null then null
                       else jsonb_build_object('reason', l.voided_reason, 'by', l.voided_by, 'at', _ms(l.voided_at)) end
      ) order by l.idx)
      from order_lines l where l.order_id = o.id), '[]'::jsonb))
  from orders o where o.id = p_id $$;

create function _tab_json(p_id uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'number', t.number, 'tableId', t.table_id, 'tableLabel', t.table_label, 'status', t.status,
    'openedAt', _ms(t.opened_at), 'closedAt', _ms(t.closed_at), 'waiter', t.waiter,
    'taxRate', t.tax_rate, 'serviceRate', t.service_rate,
    'discount', case when t.discount_type is null then null
                     else jsonb_build_object('type', t.discount_type, 'value', t.discount_value,
                                             'reason', t.discount_reason, 'by', t.discount_by) end,
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'method', p.method, 'amount', p.amount,
                                          'at', _ms(p.created_at), 'by', p.by_name) order by p.created_at)
      from payments p where p.tab_id = t.id), '[]'::jsonb))
  from tabs t where t.id = p_id $$;

create function _item_json(p_id uuid, p_recipe boolean) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', i.id, 'name', i.name, 'description', i.description, 'price', i.price, 'categoryId', i.category_id,
    'station', i.station, 'popular', i.popular, 'available', i.available, 'extras', i.extras,
    'stockOut', _stock_out(i.id),
    'recipe', case when p_recipe then coalesce((
        select jsonb_agg(jsonb_build_object('ingredientId', r.ingredient_id, 'qty', r.qty) order by r.ingredient_id)
        from recipe_lines r where r.item_id = i.id), '[]'::jsonb) else '[]'::jsonb end)
  from items i where i.id = p_id $$;

-- ---------- reading ----------
-- What a customer scanning a table's QR code may see: the menu and that one table. Nothing else.
create function get_public_menu(p_table text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'state', jsonb_build_object(
    'settings', (select jsonb_build_object(
        'name', s.name, 'openText', s.open_text, 'currency', s.currency, 'taxRate', s.tax_rate,
        'serviceRate', s.service_rate, 'orderingOpen', s.ordering_open,
        'customerRequests', s.customer_requests, 'blockOutOfStock', s.block_out_of_stock) from settings s where s.id = 1),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'order', c.position) order by c.position, c.name) from categories c), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(_item_json(i.id, false) order by i.name) from items i), '[]'::jsonb),
    'tables', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label)) from dining_tables t where t.id = p_table), '[]'::jsonb)
  )) $$;

-- A customer follows their own orders by id. Ids are random uuids, so only the person who placed an order knows them.
create function get_orders_by_ids(p_ids uuid[]) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(_order_json(o.id) order by o.created_at desc), '[]'::jsonb)
  from orders o where o.id = any (p_ids[1:20]) $$;

-- Everything the staff screens need, in one call.
create function staff_snapshot() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - interval '14 days';
begin
  if not is_staff() then return _fail('Not allowed.'); end if;
  return jsonb_build_object('ok', true, 'state', jsonb_build_object(
    'settings', _settings_json(),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'order', c.position) order by c.position, c.name) from categories c), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(_item_json(i.id, true) order by i.name) from items i), '[]'::jsonb),
    'ingredients', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'unit', g.unit, 'onHand', g.on_hand, 'lowAt', g.low_at) order by g.name) from ingredients g), '[]'::jsonb),
    'stockMoves', coalesce((select jsonb_agg(x.j order by x.at) from (
        select jsonb_build_object('id', m.id, 'ingredientId', m.ingredient_id, 'delta', m.delta, 'reason', m.reason,
                                  'note', m.note, 'orderId', m.order_id, 'by', m.by_name, 'at', _ms(m.created_at)) as j, m.created_at as at
        from stock_moves m order by m.created_at desc limit 300) x), '[]'::jsonb),
    'tables', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label) order by t.created_at, t.label) from dining_tables t), '[]'::jsonb),
    'tabs', coalesce((select jsonb_agg(_tab_json(t.id) order by t.opened_at) from tabs t
                      where t.status in ('open', 'bill') or t.opened_at >= since or t.closed_at >= since), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(_order_json(o.id) order by o.created_at) from orders o
                        where o.created_at >= since or o.status in ('new', 'preparing', 'ready')), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'tableId', r.table_id, 'tableLabel', r.table_label,
                            'type', r.type, 'status', r.status, 'createdAt', _ms(r.created_at), 'doneAt', _ms(r.done_at), 'doneBy', r.done_by)
                            order by r.created_at)
                          from service_requests r where r.status = 'open' or r.created_at >= now() - interval '1 day'), '[]'::jsonb),
    'audit', case when is_manager() then coalesce((select jsonb_agg(x.j order by x.at) from (
        select jsonb_build_object('id', a.id::text, 'at', _ms(a.at), 'by', a.by_name, 'action', a.action, 'detail', a.detail) as j, a.at
        from audit_log a order by a.at desc limit 100) x), '[]'::jsonb) else '[]'::jsonb end
  ));
end $$;

-- ---------- placing and moving orders ----------
-- p = { "tableId": "7", "lines": [{ "itemId": "<uuid>", "qty": 2, "extras": ["Extra cheese"], "note": "" }], "note": "" }
-- Customers need ordering to be open; waiters, managers and owners can always order.
create function place_order(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_set settings; v_staff boolean := is_waiter_up(); v_actor text := _actor();
  v_table dining_tables; v_tab tabs; v_order orders; v_ln jsonb; v_it items;
  v_priced jsonb := '[]'::jsonb; v_extras jsonb; v_unit int; v_qty int; v_sub int := 0; v_i int := 0;
  v_name text; v_ex jsonb; v_bad text; v_r record;
begin
  select * into v_set from settings where id = 1;
  if not v_staff and not v_set.ordering_open then
    return _fail('Ordering is paused right now. Please ask a member of staff.');
  end if;
  select * into v_table from dining_tables where id = p->>'tableId';
  if not found then return _fail('This table is not recognised. Please scan the QR code again.'); end if;
  if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines') = 0 then
    return _fail('Your order is empty.');
  end if;
  if jsonb_array_length(p->'lines') > 60 then return _fail('That order is too large. Please split it.'); end if;

  -- price every line from the current menu (never trust prices sent by the browser)
  for v_ln in select * from jsonb_array_elements(p->'lines') loop
    if coalesce(v_ln->>'itemId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then continue; end if;
    select * into v_it from items where id = (v_ln->>'itemId')::uuid;
    if not found then continue; end if;
    v_qty := case when coalesce(v_ln->>'qty', '') ~ '^[0-9]+(\.[0-9]+)?$' then floor((v_ln->>'qty')::numeric)::int else 1 end;
    if v_qty < 1 then v_qty := 1; end if;
    if v_qty > 50 then v_qty := 50; end if;
    v_unit := v_it.price;
    v_extras := '[]'::jsonb;
    if jsonb_typeof(v_ln->'extras') = 'array' then
      for v_name in select jsonb_array_elements_text(v_ln->'extras') loop
        select e into v_ex from jsonb_array_elements(v_it.extras) e where e->>'name' = v_name limit 1;
        if v_ex is not null then
          v_extras := v_extras || jsonb_build_array(jsonb_build_object('name', v_ex->>'name', 'price', (v_ex->>'price')::int));
          v_unit := v_unit + (v_ex->>'price')::int;
        end if;
        v_ex := null;
      end loop;
    end if;
    if not v_it.available or (v_set.block_out_of_stock and _stock_out(v_it.id)) then
      return _fail(v_it.name || ' is sold out. Please remove it to continue.');
    end if;
    v_priced := v_priced || jsonb_build_array(jsonb_build_object(
      'itemId', v_it.id, 'name', v_it.name, 'station', v_it.station, 'qty', v_qty, 'unit', v_unit,
      'extras', v_extras, 'note', left(trim(coalesce(v_ln->>'note', '')), 140)));
    v_sub := v_sub + v_unit * v_qty;
  end loop;
  if jsonb_array_length(v_priced) = 0 then return _fail('Your order is empty.'); end if;

  -- lock the ingredients involved so two simultaneous orders can't both take the last portion
  perform 1 from ingredients where id in (
    select r.ingredient_id from jsonb_array_elements(v_priced) pl
    join recipe_lines r on r.item_id = (pl->>'itemId')::uuid) order by id for update;
  if v_set.block_out_of_stock then
    select g.name into v_bad from (
      select r.ingredient_id, sum(r.qty * (pl->>'qty')::int) as need
      from jsonb_array_elements(v_priced) pl join recipe_lines r on r.item_id = (pl->>'itemId')::uuid
      group by r.ingredient_id) u
    join ingredients g on g.id = u.ingredient_id where g.on_hand < u.need order by g.name limit 1;
    if v_bad is not null then return _fail('Not enough ' || v_bad || ' in stock for this order.'); end if;
  end if;

  -- find or open the bill (takeaway orders each get their own bill)
  if v_table.id <> 'takeaway' then
    select * into v_tab from tabs where table_id = v_table.id and status in ('open', 'bill') for update;
  end if;
  if v_tab.id is null then
    begin
      insert into tabs (table_id, table_label, waiter, tax_rate, service_rate)
      values (v_table.id, v_table.label, case when v_staff then v_actor end, v_set.tax_rate, v_set.service_rate)
      returning * into v_tab;
    exception when unique_violation then
      select * into v_tab from tabs where table_id = v_table.id and status in ('open', 'bill') for update;
    end;
  elsif v_tab.status = 'bill' or (v_tab.waiter is null and v_staff) then
    update tabs set status = 'open', waiter = coalesce(waiter, case when v_staff then v_actor end)
    where id = v_tab.id returning * into v_tab;
  end if;

  insert into orders (tab_id, table_id, table_label, source, placed_by, note, subtotal, tax, service, total)
  values (v_tab.id, v_table.id, v_table.label, case when v_staff then 'waiter' else 'customer' end,
          case when v_staff then v_actor end, left(trim(coalesce(p->>'note', '')), 200), v_sub,
          round(v_sub * v_tab.tax_rate / 100)::int, round(v_sub * v_tab.service_rate / 100)::int,
          v_sub + round(v_sub * v_tab.tax_rate / 100)::int + round(v_sub * v_tab.service_rate / 100)::int)
  returning * into v_order;

  for v_ln in select * from jsonb_array_elements(v_priced) loop
    insert into order_lines (order_id, idx, item_id, name, station, qty, unit, extras, note)
    values (v_order.id, v_i, (v_ln->>'itemId')::uuid, v_ln->>'name', v_ln->>'station', (v_ln->>'qty')::int,
            (v_ln->>'unit')::int, v_ln->'extras', v_ln->>'note');
    v_i := v_i + 1;
  end loop;

  for v_r in
    select r.ingredient_id, sum(r.qty * (pl->>'qty')::int) as q
    from jsonb_array_elements(v_priced) pl join recipe_lines r on r.item_id = (pl->>'itemId')::uuid
    group by r.ingredient_id order by r.ingredient_id
  loop
    perform _stock_move(v_r.ingredient_id, -v_r.q, 'sale', 'Order #' || v_order.number, v_order.id);
  end loop;

  perform _audit('order.place', '#' || v_order.number || ' · ' || v_table.label);
  return jsonb_build_object('ok', true, 'order', _order_json(v_order.id));
end $$;

create function set_order_status(p_id uuid, p_status text, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_o orders; v_flow text[] := array['new', 'preparing', 'ready', 'served']; v_idx int; v_now timestamptz := now();
begin
  if not is_staff() then return _fail('Not allowed.'); end if;
  if p_status not in ('new', 'preparing', 'ready', 'served', 'cancelled') then return _fail('Unknown status.'); end if;
  select * into v_o from orders where id = p_id for update;
  if not found then return _fail('Order not found.'); end if;
  if not p_force then
    if p_status = 'cancelled' then
      if v_o.status not in ('new', 'preparing', 'ready') then return _fail('This order can no longer be cancelled.'); end if;
    elsif array_position(v_flow, p_status) is distinct from array_position(v_flow, v_o.status) + 1 then
      return _fail('This order has already been updated.');
    end if;
  end if;

  if p_status = 'cancelled' then
    update orders set status = 'cancelled', cancelled_at = v_now where id = p_id;
    -- food that hasn't been started goes back into stock; started food is wasted
    if v_o.status = 'new' and not v_o.restocked then
      perform _restock_order(p_id, 1, 'return', 'Cancelled #' || v_o.number);
      update orders set restocked = true where id = p_id;
    end if;
    perform _audit('order.cancel', '#' || v_o.number || ' · ' || v_o.table_label);
    perform _void_empty_takeaway(v_o.tab_id);
  else
    v_idx := array_position(v_flow, p_status);
    if v_o.status = 'cancelled' and v_o.restocked then
      perform _restock_order(p_id, -1, 'sale', 'Restored #' || v_o.number);
      update orders set restocked = false where id = p_id;
    end if;
    update orders set status = p_status, cancelled_at = null,
      started_at = case when v_idx >= 2 then coalesce(started_at, v_now) end,
      ready_at = case when v_idx >= 3 then coalesce(ready_at, v_now) end,
      served_at = case when v_idx >= 4 then coalesce(served_at, v_now) end
    where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'previous', v_o.status);
end $$;

create function void_line(p_order uuid, p_idx int, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_o orders; v_t tabs; v_l order_lines; v_reason text := left(trim(coalesce(p_reason, '')), 120); v_sub int; v_r record;
begin
  if char_length(v_reason) < 3 then return _fail('Enter a reason for removing this item.'); end if;
  if not (is_manager() or (_role() = 'waiter' and (select waiter_can_void from settings where id = 1))) then
    return _fail('You are not allowed to remove items. Ask a manager.');
  end if;
  select * into v_o from orders where id = p_order for update;
  if not found or v_o.status = 'cancelled' then return _fail('Order not found.'); end if;
  select * into v_t from tabs where id = v_o.tab_id for update;
  if v_t.status not in ('open', 'bill') then return _fail('This bill is already closed.'); end if;
  select * into v_l from order_lines where order_id = p_order and idx = p_idx for update;
  if not found or v_l.voided_at is not null then return _fail('This item was already removed.'); end if;

  update order_lines set voided_reason = v_reason, voided_by = _actor(), voided_at = now() where id = v_l.id;
  if v_o.status = 'new' and not v_o.restocked and v_l.item_id is not null then
    for v_r in select ingredient_id, qty from recipe_lines where item_id = v_l.item_id order by ingredient_id loop
      perform _stock_move(v_r.ingredient_id, v_r.qty * v_l.qty, 'return', 'Removed from #' || v_o.number, v_o.id);
    end loop;
  end if;
  select coalesce(sum(qty * unit), 0) into v_sub from order_lines where order_id = p_order and voided_at is null;
  update orders set subtotal = v_sub, tax = round(v_sub * v_t.tax_rate / 100)::int,
    service = round(v_sub * v_t.service_rate / 100)::int,
    total = v_sub + round(v_sub * v_t.tax_rate / 100)::int + round(v_sub * v_t.service_rate / 100)::int
  where id = p_order;
  perform _audit('line.void', '#' || v_o.number || ' · ' || v_l.qty || '× ' || v_l.name || ' · ' || v_reason);
  perform _void_empty_takeaway(v_t.id);
  return jsonb_build_object('ok', true);
end $$;

-- ---------- bills and payments ----------
-- p_type null clears the discount. p_type 'percent' takes 0-100, 'amount' takes cents.
create function set_discount(p_tab uuid, p_type text, p_value numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_t tabs; v_bill jsonb; v_sub int; v_lim numeric; v_pct numeric; v_reason text := left(trim(coalesce(p_reason, '')), 120);
begin
  if not is_waiter_up() then return _fail('Not allowed.'); end if;
  select * into v_t from tabs where id = p_tab for update;
  if not found or v_t.status not in ('open', 'bill') then return _fail('This bill is already closed.'); end if;
  v_bill := _tab_bill(p_tab);
  v_sub := (v_bill->>'subtotal')::int;
  select waiter_max_discount into v_lim from settings where id = 1;

  if p_type is null then
    v_pct := case when v_t.discount_type = 'percent' then v_t.discount_value
                  when v_t.discount_type = 'amount' and v_sub > 0 then v_t.discount_value / v_sub * 100
                  else 0 end;
    if _role() = 'waiter' and v_pct > v_lim then return _fail('Only a manager can remove this discount.'); end if;
    update tabs set discount_type = null, discount_value = null, discount_reason = null, discount_by = null where id = p_tab;
    perform _audit('discount.clear', v_t.table_label);
    return jsonb_build_object('ok', true);
  end if;

  if p_type not in ('percent', 'amount') then return _fail('Choose a discount type.'); end if;
  if p_value is null or p_value <= 0 then return _fail('Enter a discount greater than zero.'); end if;
  if p_type = 'percent' and p_value > 100 then return _fail('A percentage can''t be more than 100.'); end if;
  if p_type = 'amount' and p_value <> floor(p_value) then return _fail('Enter a valid amount.'); end if;
  if v_sub <= 0 then return _fail('There is nothing to discount yet.'); end if;
  if p_type = 'amount' and p_value > v_sub then return _fail('The discount can''t be more than the bill.'); end if;
  if char_length(v_reason) < 3 then return _fail('Enter a reason for the discount.'); end if;
  v_pct := case when p_type = 'percent' then p_value else p_value / v_sub * 100 end;
  if _role() = 'waiter' and v_pct > v_lim then
    return _fail('Discounts above ' || trim(trailing '.' from trim(trailing '0' from v_lim::text)) || '% need a manager.');
  end if;
  update tabs set discount_type = p_type, discount_value = p_value, discount_reason = v_reason, discount_by = _actor()
  where id = p_tab;
  perform _audit('discount.set', v_t.table_label || ' · ' || p_value || case when p_type = 'percent' then '%' else '' end || ' · ' || v_reason);
  return jsonb_build_object('ok', true);
end $$;

create function add_payment(p_tab uuid, p_method text, p_amount int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_t tabs; v_bill jsonb; v_total int; v_paid int; v_due int; v_closed boolean;
begin
  if not is_waiter_up() then return _fail('Not allowed.'); end if;
  select * into v_t from tabs where id = p_tab for update;
  if not found or v_t.status not in ('open', 'bill') then return _fail('This bill is already closed.'); end if;
  if p_method is null or p_method not in ('cash', 'card', 'other') then return _fail('Choose a payment method.'); end if;
  if p_amount is null or p_amount <= 0 then return _fail('Enter a valid amount.'); end if;
  v_bill := _tab_bill(p_tab);
  v_total := (v_bill->>'total')::int; v_paid := (v_bill->>'paid')::int; v_due := (v_bill->>'due')::int;
  if v_total <= 0 then return _fail('There is nothing to pay on this bill.'); end if;
  if p_amount > v_due then return _fail('That is more than the balance due.'); end if;
  insert into payments (tab_id, method, amount, by_name) values (p_tab, p_method, p_amount, _actor());
  v_closed := v_paid + p_amount >= v_total;
  if v_closed then
    update tabs set status = 'paid', closed_at = now() where id = p_tab;
    update service_requests set status = 'done', done_at = now(), done_by = _actor()
    where table_id = v_t.table_id and status = 'open' and type = 'bill';
  end if;
  perform _audit('payment', v_t.table_label || ' · ' || p_method || ' · ' || p_amount);
  return jsonb_build_object('ok', true, 'closed', v_closed);
end $$;

create function close_tab(p_tab uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t tabs;
begin
  if not is_waiter_up() then return _fail('Not allowed.'); end if;
  select * into v_t from tabs where id = p_tab for update;
  if not found or v_t.status not in ('open', 'bill') then return _fail('This bill is already closed.'); end if;
  if (_tab_bill(p_tab)->>'total')::int > 0 then return _fail('Take payment before closing this bill.'); end if;
  update tabs set status = 'void', closed_at = now() where id = p_tab;
  perform _audit('tab.close', v_t.table_label);
  return jsonb_build_object('ok', true);
end $$;

create function move_tab(p_tab uuid, p_to text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t tabs; v_to dining_tables;
begin
  if not is_waiter_up() then return _fail('Not allowed.'); end if;
  select * into v_t from tabs where id = p_tab for update;
  if not found or v_t.status not in ('open', 'bill') then return _fail('This bill is already closed.'); end if;
  select * into v_to from dining_tables where id = p_to;
  if not found or v_to.id = 'takeaway' then return _fail('Choose a table.'); end if;
  if exists (select 1 from tabs where table_id = v_to.id and status in ('open', 'bill')) then
    return _fail(v_to.label || ' already has an open bill. Use merge instead.');
  end if;
  update tabs set table_id = v_to.id, table_label = v_to.label where id = p_tab;
  update orders set table_id = v_to.id, table_label = v_to.label where tab_id = p_tab;
  perform _audit('tab.move', v_t.table_label || ' → ' || v_to.label);
  return jsonb_build_object('ok', true);
end $$;

create function merge_tabs(p_from uuid, p_into uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_from tabs; v_into tabs;
begin
  if not is_waiter_up() then return _fail('Not allowed.'); end if;
  if p_from = p_into then return _fail('Choose two open bills.'); end if;
  -- lock in a fixed order so two merges can't deadlock
  perform 1 from tabs where id in (p_from, p_into) order by id for update;
  select * into v_from from tabs where id = p_from and status in ('open', 'bill');
  select * into v_into from tabs where id = p_into and status in ('open', 'bill');
  if v_from.id is null or v_into.id is null then return _fail('Choose two open bills.'); end if;
  if exists (select 1 from payments where tab_id = p_from) then return _fail('A bill with payments can''t be merged.'); end if;
  update orders set tab_id = p_into, table_id = v_into.table_id, table_label = v_into.table_label where tab_id = p_from;
  update tabs set status = 'void', closed_at = now() where id = p_from;
  perform _audit('tab.merge', v_from.table_label || ' → ' || v_into.table_label);
  return jsonb_build_object('ok', true);
end $$;

-- ---------- call waiter / request bill ----------
create function request_service(p_table text, p_type text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_table dining_tables; v_req service_requests; v_tab tabs;
begin
  select * into v_table from dining_tables where id = p_table;
  if not found or v_table.id = 'takeaway' then return _fail('This table is not recognised.'); end if;
  if p_type is null or p_type not in ('waiter', 'bill') then return _fail('Unknown request.'); end if;
  if not is_waiter_up() and not (select customer_requests from settings where id = 1) then
    return _fail('Please ask a member of staff.');
  end if;
  select * into v_req from service_requests where table_id = p_table and type = p_type and status = 'open' limit 1;
  if found then return jsonb_build_object('ok', true); end if;
  if p_type = 'bill' then
    select * into v_tab from tabs where table_id = p_table and status in ('open', 'bill') for update;
    if not found then return _fail('There is no open order for this table yet.'); end if;
    update tabs set status = 'bill' where id = v_tab.id;
  end if;
  insert into service_requests (table_id, table_label, type) values (p_table, v_table.label, p_type);
  return jsonb_build_object('ok', true);
end $$;

create function resolve_request(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_waiter_up() then return _fail('Not allowed.'); end if;
  update service_requests set status = 'done', done_at = now(), done_by = _actor() where id = p_id;
  if not found then return _fail('Request not found.'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- inventory ----------
-- p = { "id": "<uuid, when editing>", "name": "Chicken", "unit": "kg", "lowAt": 3, "onHand": 12 (new only) }
create function upsert_ingredient(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := trim(coalesce(p->>'name', '')); v_id uuid; v_low numeric; v_on numeric; v_unit text := p->>'unit';
begin
  if not is_manager() then return _fail('Not allowed.'); end if;
  if v_name = '' then return _fail('Enter an ingredient name.'); end if;
  v_id := nullif(p->>'id', '')::uuid;
  if exists (select 1 from ingredients where lower(name) = lower(v_name) and id is distinct from v_id) then
    return _fail('An ingredient with this name already exists.');
  end if;
  if coalesce(p->>'lowAt', '') !~ '^[0-9]+(\.[0-9]+)?$' then return _fail('Enter a valid low-stock level.'); end if;
  v_low := (p->>'lowAt')::numeric;
  if v_unit is null or v_unit not in ('pcs', 'kg', 'g', 'l', 'ml', 'portion') then return _fail('Choose a unit.'); end if;
  if v_id is not null then
    update ingredients set name = left(v_name, 50), unit = v_unit, low_at = v_low where id = v_id;
    return jsonb_build_object('ok', true);
  end if;
  if coalesce(p->>'onHand', '0') !~ '^[0-9]+(\.[0-9]+)?$' then return _fail('Enter a valid opening stock.'); end if;
  v_on := round(coalesce(p->>'onHand', '0')::numeric, 3);
  insert into ingredients (name, unit, on_hand, low_at) values (left(v_name, 50), v_unit, v_on, v_low) returning id into v_id;
  if v_on > 0 then
    insert into stock_moves (ingredient_id, delta, reason, note, by_name) values (v_id, v_on, 'restock', 'Opening stock', _actor());
  end if;
  return jsonb_build_object('ok', true);
end $$;

create function delete_ingredient(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_manager() then return _fail('Not allowed.'); end if;
  if exists (select 1 from recipe_lines where ingredient_id = p_id) then
    return _fail('This ingredient is used in a recipe. Remove it from the dishes first.');
  end if;
  delete from ingredients where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- p_reason: restock (positive), waste (negative) or adjust (either). p_delta is the change in quantity.
create function adjust_stock(p_ingredient uuid, p_delta numeric, p_reason text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_g ingredients;
begin
  if not is_manager() then return _fail('Not allowed.'); end if;
  select * into v_g from ingredients where id = p_ingredient for update;
  if not found then return _fail('Ingredient not found.'); end if;
  if p_reason is null or p_reason not in ('restock', 'waste', 'adjust') then return _fail('Choose a reason.'); end if;
  if p_delta is null or p_delta = 0 then return _fail('Enter a quantity.'); end if;
  if p_reason = 'restock' and p_delta < 0 then return _fail('A delivery must be a positive quantity.'); end if;
  if p_reason = 'waste' and p_delta > 0 then return _fail('Waste must be a negative quantity.'); end if;
  if round(v_g.on_hand + p_delta, 3) < 0 then return _fail('Stock can''t go below zero.'); end if;
  perform _stock_move(p_ingredient, p_delta, p_reason, left(trim(coalesce(p_note, '')), 120), null);
  perform _audit('stock.' || p_reason, v_g.name || ' ' || case when p_delta > 0 then '+' else '' end || round(p_delta, 3) || ' ' || v_g.unit);
  return jsonb_build_object('ok', true);
end $$;

-- ---------- menu management (manager or owner) ----------
create function upsert_category(p_id uuid, p_name text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n text := trim(coalesce(p_name, ''));
begin
  if not is_manager() then return _fail('Not allowed.'); end if;
  if v_n = '' then return _fail('Enter a category name.'); end if;
  if exists (select 1 from categories where lower(name) = lower(v_n) and id is distinct from p_id) then
    return _fail('A category with this name already exists.');
  end if;
  if p_id is not null then
    update categories set name = left(v_n, 30) where id = p_id;
  else
    insert into categories (name, position) values (left(v_n, 30), coalesce((select max(position) from categories), 0) + 1);
  end if;
  return jsonb_build_object('ok', true);
end $$;

create function delete_category(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_manager() then return _fail('Not allowed.'); end if;
  if exists (select 1 from items where category_id = p_id) then
    return _fail('Move or delete the dishes in this category first.');
  end if;
  delete from categories where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create function move_category(p_id uuid, p_dir int) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rn int; v_count int;
begin
  if not is_manager() then return _fail('Not allowed.'); end if;
  select count(*) into v_count from categories;
  select rn into v_rn from (select id, row_number() over (order by position, name) as rn from categories) o where id = p_id;
  if v_rn is null or v_rn + p_dir < 1 or v_rn + p_dir > v_count or p_dir not in (-1, 1) then
    return jsonb_build_object('ok', true);
  end if;
  update categories c set position = case when o.rn = v_rn then v_rn + p_dir when o.rn = v_rn + p_dir then v_rn else o.rn end
  from (select id, row_number() over (order by position, name) as rn from categories) o where o.id = c.id;
  return jsonb_build_object('ok', true);
end $$;

-- p = { id?, name, description, price (cents), categoryId, station, popular, available,
--       extras: [{name, price}], recipe: [{ingredientId, qty}] }
create function upsert_item(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid; v_name text := trim(coalesce(p->>'name', '')); v_cat uuid; v_price int;
  v_extras jsonb := '[]'::jsonb; v_e jsonb; v_en text; v_seen text[] := '{}'; v_rec jsonb; v_rg text; v_rseen text[] := '{}';
  v_q numeric;
begin
  if not is_manager() then return _fail('Not allowed.'); end if;
  if v_name = '' then return _fail('Enter a dish name.'); end if;
  if jsonb_typeof(p->'price') is distinct from 'number' or (p->>'price')::numeric <> floor((p->>'price')::numeric) or (p->>'price')::numeric < 0 then
    return _fail('Enter a valid price.');
  end if;
  v_price := (p->>'price')::int;
  if coalesce(p->>'categoryId', '') !~* '^[0-9a-f-]{36}$' or not exists (select 1 from categories where id = (p->>'categoryId')::uuid) then
    return _fail('Choose a category.');
  end if;
  v_cat := (p->>'categoryId')::uuid;
  if coalesce(p->>'station', '') not in ('grill', 'kitchen', 'cold') then return _fail('Choose a station.'); end if;

  if jsonb_typeof(p->'extras') = 'array' then
    for v_e in select * from jsonb_array_elements(p->'extras') loop
      v_en := trim(coalesce(v_e->>'name', ''));
      if v_en = '' then continue; end if;
      if jsonb_typeof(v_e->'price') is distinct from 'number' or (v_e->>'price')::numeric <> floor((v_e->>'price')::numeric) or (v_e->>'price')::numeric < 0 then
        return _fail('Check the extra prices.');
      end if;
      if lower(v_en) = any (v_seen) then return _fail('Extras must have different names.'); end if;
      v_seen := v_seen || lower(v_en);
      v_extras := v_extras || jsonb_build_array(jsonb_build_object('name', v_en, 'price', (v_e->>'price')::int));
    end loop;
  end if;

  if jsonb_typeof(p->'recipe') = 'array' then
    for v_rec in select * from jsonb_array_elements(p->'recipe') loop
      v_rg := coalesce(v_rec->>'ingredientId', '');
      if v_rg !~* '^[0-9a-f-]{36}$' or not exists (select 1 from ingredients where id = v_rg::uuid) then
        return _fail('Choose an ingredient for each recipe line.');
      end if;
      if coalesce(v_rec->>'qty', '') !~ '^[0-9]+(\.[0-9]+)?$' or (v_rec->>'qty')::numeric <= 0 then
        return _fail('Recipe quantities must be greater than zero.');
      end if;
      if lower(v_rg) = any (v_rseen) then return _fail('Each ingredient can only appear once in a recipe.'); end if;
      v_rseen := v_rseen || lower(v_rg);
    end loop;
  end if;

  if v_id is not null and exists (select 1 from items where id = v_id) then
    update items set name = left(v_name, 60), description = left(trim(coalesce(p->>'description', '')), 120), price = v_price,
      category_id = v_cat, station = p->>'station', popular = coalesce((p->>'popular')::boolean, false),
      available = coalesce((p->>'available')::boolean, true), extras = v_extras
    where id = v_id;
  else
    insert into items (name, description, price, category_id, station, popular, available, extras)
    values (left(v_name, 60), left(trim(coalesce(p->>'description', '')), 120), v_price, v_cat, p->>'station',
            coalesce((p->>'popular')::boolean, false), coalesce((p->>'available')::boolean, true), v_extras)
    returning id into v_id;
  end if;
  delete from recipe_lines where item_id = v_id;
  if jsonb_typeof(p->'recipe') = 'array' then
    for v_rec in select * from jsonb_array_elements(p->'recipe') loop
      insert into recipe_lines (item_id, ingredient_id, qty)
      values (v_id, (v_rec->>'ingredientId')::uuid, round((v_rec->>'qty')::numeric, 3));
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'item', _item_json(v_id, true));
end $$;

create function delete_item(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_manager() then return _fail('Not allowed.'); end if;
  delete from items where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create function set_item_available(p_id uuid, p_available boolean) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_manager() then return _fail('Not allowed.'); end if;
  update items set available = coalesce(p_available, true) where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- tables and settings ----------
create function add_table(p_label text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_l text := left(trim(coalesce(p_label, '')), 30); v_slug text; v_id text;
begin
  if not is_manager() then return _fail('Not allowed.'); end if;
  if v_l = '' then return _fail('Enter a table name.'); end if;
  if exists (select 1 from dining_tables where lower(label) = lower(v_l)) then return _fail('A table with this name already exists.'); end if;
  v_slug := trim(both '-' from regexp_replace(lower(v_l), '[^a-z0-9]+', '-', 'g'));
  if v_slug = '' then v_slug := 'table'; end if;
  v_id := v_slug;
  while exists (select 1 from dining_tables where id = v_id) loop
    v_id := v_slug || '-' || substr(md5(random()::text), 1, 3);
  end loop;
  insert into dining_tables (id, label) values (v_id, v_l);
  return jsonb_build_object('ok', true);
end $$;

create function delete_table(p_id text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_manager() then return _fail('Not allowed.'); end if;
  if p_id = 'takeaway' then return _fail('The takeaway code can''t be removed.'); end if;
  if exists (select 1 from tabs where table_id = p_id and status in ('open', 'bill')) then return _fail('This table has an open bill.'); end if;
  delete from dining_tables where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- p holds any of the settings the app sends (camelCase keys). Missing keys are left unchanged.
create function update_settings(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_manager() then return _fail('Not allowed.'); end if;
  update settings set
    name = case when p ? 'name' then left(trim(p->>'name'), 40) else name end,
    open_text = case when p ? 'openText' then left(trim(p->>'openText'), 40) else open_text end,
    currency = case when p ? 'currency' then left(trim(p->>'currency'), 3) else currency end,
    tax_rate = case when p ? 'taxRate' then (p->>'taxRate')::numeric else tax_rate end,
    service_rate = case when p ? 'serviceRate' then (p->>'serviceRate')::numeric else service_rate end,
    ordering_open = case when p ? 'orderingOpen' then (p->>'orderingOpen')::boolean else ordering_open end,
    customer_requests = case when p ? 'customerRequests' then (p->>'customerRequests')::boolean else customer_requests end,
    block_out_of_stock = case when p ? 'blockOutOfStock' then (p->>'blockOutOfStock')::boolean else block_out_of_stock end,
    public_url = case when p ? 'publicUrl' then left(trim(p->>'publicUrl'), 200) else public_url end,
    waiter_can_void = case when p ? 'waiterCanVoid' then (p->>'waiterCanVoid')::boolean else waiter_can_void end,
    waiter_max_discount = case when p ? 'waiterMaxDiscount' then (p->>'waiterMaxDiscount')::numeric else waiter_max_discount end,
    business_address = case when p ? 'businessAddress' then left(trim(p->>'businessAddress'), 80) else business_address end,
    business_phone = case when p ? 'businessPhone' then left(trim(p->>'businessPhone'), 30) else business_phone end,
    tax_id = case when p ? 'taxId' then left(trim(p->>'taxId'), 30) else tax_id end,
    receipt_header = case when p ? 'receiptHeader' then left(trim(p->>'receiptHeader'), 60) else receipt_header end,
    receipt_footer = case when p ? 'receiptFooter' then left(trim(p->>'receiptFooter'), 120) else receipt_footer end,
    paper_width = case when p ? 'paperWidth' then (p->>'paperWidth')::int else paper_width end,
    receipt_copies = case when p ? 'receiptCopies' then (p->>'receiptCopies')::int else receipt_copies end,
    kitchen_auto_print = case when p ? 'kitchenAutoPrint' then (p->>'kitchenAutoPrint')::boolean else kitchen_auto_print end,
    kitchen_split_stations = case when p ? 'kitchenSplitStations' then (p->>'kitchenSplitStations')::boolean else kitchen_split_stations end
  where id = 1;
  return jsonb_build_object('ok', true);
exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
  return _fail('Check the values you entered.');
end $$;
