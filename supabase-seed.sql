-- Optional sample data: a small Lebanese menu with recipes and stock. Run it once after the migrations.
-- (Skip it for a real restaurant and add your own menu in the Admin panel.)
do $$
declare
  c_starters uuid; c_mains uuid; c_grill uuid; c_desserts uuid; c_drinks uuid;
  g_patty uuid; g_bun uuid; g_chicken uuid; g_halloumi uuid; g_lamb uuid; g_lemon uuid; g_coffee uuid; g_water uuid;
  i_halloumi uuid; i_burger uuid; i_shawarma uuid; i_tawook uuid; i_lamb uuid; i_lemonade uuid; i_coffee uuid; i_water uuid;
begin
  update settings set name = 'Cedar and Coal', open_text = 'Open until 11:00 PM', tax_rate = 11 where id = 1;

  insert into categories (name, position) values ('Starters', 1) returning id into c_starters;
  insert into categories (name, position) values ('Mains', 2) returning id into c_mains;
  insert into categories (name, position) values ('Grill', 3) returning id into c_grill;
  insert into categories (name, position) values ('Desserts', 4) returning id into c_desserts;
  insert into categories (name, position) values ('Drinks', 5) returning id into c_drinks;

  insert into ingredients (name, unit, on_hand, low_at) values ('Beef patties', 'pcs', 42, 10) returning id into g_patty;
  insert into ingredients (name, unit, on_hand, low_at) values ('Burger buns', 'pcs', 38, 10) returning id into g_bun;
  insert into ingredients (name, unit, on_hand, low_at) values ('Chicken', 'kg', 12, 3) returning id into g_chicken;
  insert into ingredients (name, unit, on_hand, low_at) values ('Halloumi', 'kg', 4.5, 1) returning id into g_halloumi;
  insert into ingredients (name, unit, on_hand, low_at) values ('Lamb chops', 'pcs', 24, 8) returning id into g_lamb;
  insert into ingredients (name, unit, on_hand, low_at) values ('Lemons', 'kg', 8, 2) returning id into g_lemon;
  insert into ingredients (name, unit, on_hand, low_at) values ('Coffee beans', 'kg', 3, 0.5) returning id into g_coffee;
  insert into ingredients (name, unit, on_hand, low_at) values ('Sparkling water bottles', 'pcs', 48, 12) returning id into g_water;
  insert into stock_moves (ingredient_id, delta, reason, note, by_name)
    select id, on_hand, 'restock', 'Opening stock', 'Seed' from ingredients;

  insert into items (name, description, price, category_id, station, popular) values
    ('Grilled Halloumi', 'Honey, thyme, toasted sesame', 750, c_starters, 'grill', true) returning id into i_halloumi;
  insert into items (name, description, price, category_id, station) values
    ('Hummus Beiruti', 'Chickpeas, tahini, chilli oil, warm pita', 600, c_starters, 'cold'),
    ('Fattoush', 'Crisp greens, sumac, pomegranate molasses', 800, c_starters, 'cold'),
    ('Fried Kibbeh', 'Bulgur shell, spiced beef, pine nuts', 900, c_starters, 'kitchen'),
    ('Mujaddara', 'Lentils, rice, crispy onions, yoghurt', 950, c_mains, 'kitchen'),
    ('Kafta Skewers', 'Spiced beef and parsley, grilled tomato', 1250, c_grill, 'grill'),
    ('Pistachio Baklava', 'Three pieces, honey syrup', 550, c_desserts, 'cold'),
    ('Muhallabia', 'Milk pudding, rose water, pistachio', 500, c_desserts, 'cold'),
    ('Jallab', 'Date molasses, rose water, pine nuts', 400, c_drinks, 'cold');
  insert into items (name, description, price, category_id, station, popular, extras) values
    ('Beef Burger', 'Aged cheddar, pickles, house sauce', 1200, c_mains, 'grill', true,
     '[{"name":"Extra cheese","price":150},{"name":"Bacon","price":200},{"name":"Extra patty","price":400}]') returning id into i_burger;
  insert into items (name, description, price, category_id, station, popular, extras) values
    ('Chicken Shawarma Plate', 'Garlic sauce, pickles, fries', 1050, c_mains, 'kitchen', true,
     '[{"name":"Extra garlic sauce","price":50},{"name":"Extra fries","price":200}]') returning id into i_shawarma;
  insert into items (name, description, price, category_id, station, available) values
    ('Grilled Sea Bass', 'Lemon, herbs, tarator sauce', 1800, c_mains, 'grill', false);
  insert into items (name, description, price, category_id, station, popular) values
    ('Mixed Grill for Two', 'Kafta, tawook, lamb chop, sides', 3200, c_grill, 'grill', true);
  insert into items (name, description, price, category_id, station) values
    ('Shish Tawook', 'Marinated chicken skewers, toum, pickles', 1300, c_grill, 'grill') returning id into i_tawook;
  insert into items (name, description, price, category_id, station) values
    ('Lamb Chops', 'Four chops, garlic, rosemary', 2200, c_grill, 'grill') returning id into i_lamb;
  insert into items (name, description, price, category_id, station, popular) values
    ('Knafeh', 'Sweet cheese, semolina, orange blossom syrup', 650, c_desserts, 'kitchen', true);
  insert into items (name, description, price, category_id, station, popular) values
    ('Fresh Lemonade', 'Mint, served over ice', 350, c_drinks, 'cold', true) returning id into i_lemonade;
  insert into items (name, description, price, category_id, station) values
    ('Arabic Coffee', 'Cardamom, served in a pot', 300, c_drinks, 'kitchen') returning id into i_coffee;
  insert into items (name, description, price, category_id, station) values
    ('Sparkling Water', '500 ml bottle', 250, c_drinks, 'cold') returning id into i_water;

  insert into recipe_lines (item_id, ingredient_id, qty) values
    (i_halloumi, g_halloumi, 0.1), (i_burger, g_patty, 1), (i_burger, g_bun, 1), (i_shawarma, g_chicken, 0.25),
    (i_tawook, g_chicken, 0.3), (i_lamb, g_lamb, 4), (i_lemonade, g_lemon, 0.15), (i_coffee, g_coffee, 0.02),
    (i_water, g_water, 1);

  insert into dining_tables (id, label)
    select n::text, 'Table ' || n from generate_series(1, 12) n;
end $$;
