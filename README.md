# Neksus Dine

QR-code restaurant system by NeksusTeam: customer menu and ordering, waiter screen, kitchen screen, admin panel.
One restaurant per project: each client gets their own copy and their own Supabase project.

## Screens

| Address | Who | What |
|---|---|---|
| `/t/:tableId` | Customers | Menu opened from the QR code on a table (`/t/takeaway` for takeaway). Order, follow progress, call the waiter, request the bill. |
| `/waiter` | Waiters, managers, owners | Table map, calls and "food ready" alerts, take orders for a table, discounts, remove items, take payments (cash/card, partial), move or merge tables, print bills and receipts. |
| `/kitchen` | Kitchen, managers, owners | Live tickets by station, undo, print kitchen tickets, optional sound and auto-print. |
| `/admin` | Managers, owners | Dashboard, orders, menu with recipes, inventory, tables and QR codes, settings. Owners also manage staff. |

## Run the local demo (no account needed)
    npm install
    npm run dev          # http://localhost:5173

Data lives in the browser and syncs between tabs on the same device. Demo PINs: kitchen 1111, waiter 2222, admin 1234.

## Connect Supabase
1. Create a project at supabase.com.
2. **Authentication > Sign In / Providers > Email**: turn off "Allow new users to sign up" (staff accounts are created by the owner).
3. **SQL Editor**: paste and run `supabase/setup.sql`. Optional: run `supabase/seed.sql` for a sample menu.
4. **Create the first owner**: Authentication > Users > Add user (email + password, tick auto-confirm), then run:

       insert into profiles (id, full_name, role)
       select id, 'Your Name', 'owner' from auth.users where email = 'you@example.com';

5. Copy `.env.example` to `.env.local` and paste your project URL and anon key (Project Settings > API).
6. Deploy the two functions (needed for the Staff page and PIN sign-in):

       npx supabase login
       npx supabase link --project-ref <your-project-ref>
       npx supabase functions deploy create-staff
       npx supabase functions deploy staff-pin

   (`supabase/config.toml` already switches off JWT checking for `staff-pin`. If your CLI ignores it, add `--no-verify-jwt` to that deploy command.)

7. `npm run dev`, open `/admin` and sign in. Add waiters and kitchen staff on the **Staff** page.

The browser never writes to tables directly. Customers can only call four functions (read the menu, place an order, follow their own orders, call the waiter). Prices are calculated on the server, and every staff action checks the signed-in role. See `supabase/migrations/0003_security.sql`.

## PIN sign-in on shared devices
1. Create each staff member on the **Staff** page, then click **Set PIN** (4 to 6 digits).
2. On each shared device (till, bar tablet, kitchen screen), a manager signs in with email and password, opens **Staff > PIN sign-in devices** and clicks **Set up this device**. The manager is signed out.
3. From then on that device shows staff names. Each person taps their name and enters their PIN. Signing out always returns to the PIN screen.

Safety: the device keeps a long secret that only a manager can create (and revoke on the Staff page); PINs are stored salted and hashed; five wrong tries lock that person for 5 minutes. Orders, payments, discounts and removals are saved with the time and the name of whoever was signed in.

## Rules worth knowing
- **One bill per table.** Every order for a table joins its open bill; paying in full closes it and the next order opens a new one. Each takeaway order has its own bill.
- **Stock.** Give a dish a recipe (ingredients used per portion) and stock goes down when it is ordered. Out-of-stock dishes disappear from ordering (switchable in Settings). Cancelling or removing an item restocks it only if the kitchen has not started it; started food counts as waste.
- **Discounts and removals.** A reason is always required and logged. Waiters are limited to the percentage set in Settings and can be blocked from removing items.
- **VAT and service** are fixed on a bill when it opens, and are charged after the discount.

## Printing
Receipts and kitchen tickets use the browser print dialog, so any installed printer works (58 mm and 80 mm layouts). For one-click printing with no dialog, start Chrome on the till or kitchen device with `--kiosk-printing`. Use Settings > Printing to preview both layouts.

## Tests
    npm test

Runs the business-rule tests, then applies the SQL migrations to a real Postgres engine (PGlite) and checks every rule, permission and security policy, that every call the app makes matches a SQL function, and the whole PIN sign-in flow (running the real `staff-pin` function code). No Supabase account needed.

## Hosting
Single-page app: send all paths to `/index.html` (Firebase Hosting, Netlify and Vercel all support a rewrite for this). Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the host's environment settings.

## Changing the database
Edit the files in `supabase/migrations`, run `npm run sql:bundle`, and keep `src/lib/engine.js` (used by the demo) in step with the SQL rules. `npm test` will tell you if they drift apart.
