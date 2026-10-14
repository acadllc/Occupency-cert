import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from './config';

let client: SupabaseClient | null = null;

/** Detects secret keys (new sb_secret_ format or legacy service_role JWT). */
export function isPrivilegedKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload?.role === 'service_role';
    } catch {
      return false;
    }
  }
  return false;
}

/** Browser client using ONLY the public publishable key; RLS enforces access. */
export function supabase(): SupabaseClient {
  if (!client) {
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase is not configured');
    if (isPrivilegedKey(SUPABASE_KEY)) {
      // refuse to run with a privileged key in the browser
      throw new Error('A secret Supabase key was supplied to the frontend. Use the publishable key.');
    }
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    });
  }
  return client;
}
