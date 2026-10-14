import type { DataApi } from './api';
import type { AuthApi } from './auth';
import { MOCK_MODE, SUPABASE_KEY, SUPABASE_URL } from './config';

export interface Backend {
  api: DataApi;
  auth: AuthApi;
  mode: 'supabase' | 'mock';
}

let backend: Promise<Backend> | null = null;

export function isConfigured() {
  return MOCK_MODE || Boolean(SUPABASE_URL && SUPABASE_KEY);
}

/** Supabase in every real build; the in-memory mock only behind an explicit test build flag. */
export function getBackend(): Promise<Backend> {
  if (!backend) {
    backend = MOCK_MODE
      ? Promise.all([import('./mockApi'), import('./auth')]).then(([m, a]) => ({ api: new m.MockApi(), auth: new a.MockAuth(), mode: 'mock' as const }))
      : Promise.all([import('./api'), import('./auth')]).then(([m, a]) => ({ api: new m.SupabaseApi(), auth: new a.SupabaseAuth(), mode: 'supabase' as const }));
  }
  return backend;
}
