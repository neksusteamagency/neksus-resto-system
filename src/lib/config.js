// Supabase mode is on when both variables are set in .env.local. Otherwise the app runs
// in local demo mode (data stored in the browser).
const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
export const SUPABASE_URL = env.VITE_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || "";
export const REMOTE = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
export const DEMO = env.VITE_DEMO_MODE === "true" && !REMOTE;
