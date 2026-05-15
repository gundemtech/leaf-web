// Shared Supabase client — single instance per page, also exposed on
// `window.supabase` so legacy snippets and the session-aware nav can read it.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://jpzqmtmmypnzqhdltcvr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bgsd10ucTMsf6D-S8jwpvg_bMo53xF_';

declare global {
  interface Window {
    supabase?: SupabaseClient;
  }
}

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
  if (typeof window !== 'undefined') window.supabase = _client;
  return _client;
}
