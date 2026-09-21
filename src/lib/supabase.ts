import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const CARD_BUCKET = "cards";

let cached: SupabaseClient | null = null;

/**
 * Server-only Supabase client using the service role key.
 *
 * The app does its own gate (team passcode), so the browser never talks to
 * Supabase directly and never sees a Supabase key. Everything goes through our
 * API routes, which is why the service role key is safe here and why the
 * tables can stay locked down with RLS and no policies.
 */
export function supabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set — see README.md step 2.",
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
