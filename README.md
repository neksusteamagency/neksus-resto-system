# Neksus Dine (phase 1)

QR-code restaurant ordering by NeksusTeam: customer menu, kitchen screen, admin panel.

## Run
    npm install
    npm run dev      # http://localhost:5173
    npm run build

## Screens
- `/`  Demo showcase (phone + live kitchen side by side). Set `VITE_DEMO_MODE=false` in `.env` for client deployments; `/` then shows a simple welcome page.
- `/t/:tableId`  Customer menu opened from a table QR code (`/t/takeaway` for takeaway).
- `/kitchen`  Kitchen screen. Demo PIN 1111.
- `/admin`  Dashboard, orders, menu, tables and QR codes, settings. Demo PIN 1234.

## How data works in phase 1
All data lives in the browser (localStorage) and syncs live between open tabs/windows on the same device,
so you can demo the full flow on one laptop. It is NOT shared between devices yet.
Everything goes through `src/lib/store.js`, which is the only file phase 2 (Firebase) replaces.
Prices are stored as integer cents. Staff PINs are a demo placeholder, not real security.

## Hosting note
Single-page app: configure a rewrite of all paths to `/index.html` (Firebase Hosting: `"rewrites": [{"source":"**","destination":"/index.html"}]`).
