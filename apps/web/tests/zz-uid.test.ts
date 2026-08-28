import { createClient } from '@supabase/supabase-js';
import { describe, it } from 'vitest';
const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY ?? '';
describe('uid', () => {
  it('are anonymous clients distinct', async () => {
    const a = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
    const b = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
    await a.auth.signInAnonymously();
    await b.auth.signInAnonymously();
    const ua = (await a.auth.getUser()).data.user?.id;
    const ub = (await b.auth.getUser()).data.user?.id;
    console.log('UIDS:', ua, ub, ua === ub ? 'SAME' : 'DIFFERENT');
  });
});
