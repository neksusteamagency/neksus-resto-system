import { createClient } from "@supabase/supabase-js";
import { REMOTE, SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export let supabase = REMOTE
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null;

// Lets tests swap in a fake client.
export function __setClientForTests(client) {
  supabase = client;
}
