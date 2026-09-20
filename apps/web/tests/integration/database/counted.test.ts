import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCustomer, listCustomers } from '@/lib/domain/customers/customers';
import { LIST_LIMIT, counted } from '@/lib/domain/counted';
import { foundBusiness } from '@/tests/support/founding';

/**
 * A list knows whether it is all of them.
 *
 * **This suite exists because of how the bug it covers was found: a test failing for the wrong
 * reason.** `platform-staff.test.ts` asserted staff visibility by reading every organization and
 * looking for two ids, which silently depended on the table holding fewer than a thousand rows —
 * PostgREST answers an unbounded select with its first thousand and says nothing. On a machine
 * that had run the suite a few hundred times it failed with *staff cannot see this tenant*, the
 * exact opposite of what had happened.
 *
 * Every list on the tenant surface had the same defect, and a business doing ten jobs a day
 * crosses a thousand work items in about three months.
 *
 * **The total is deliberately invisible to `toEqual`, which is why it needs its own test.** It is
 * non-enumerable so that forty existing assertions comparing a list's *contents* keep reading as
 * sentences — and the cost of that choice is that nothing else in the suite would notice if it
 * stopped being written at all. This is what notices.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

describe('the helper', () => {
  it('carries the count without becoming part of the list', () => {
    const list = counted([{ id: 'a' }, { id: 'b' }], 57);

    expect(list.total).toBe(57);
    // The whole design in one assertion: a caller comparing contents sees two items and no
    // metadata, which is what makes this shape survivable at forty call sites.
    expect(list).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(Object.keys(list)).toEqual(['0', '1']);
    expect(JSON.parse(JSON.stringify(list))).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('falls back to what it was handed when the server did not count', () => {
    // Reads as *this is all of them*, which is the honest answer when nothing better is known
    // and exactly what every caller assumed before any of this existed.
    expect(counted([1, 2, 3], null).total).toBe(3);
    expect(counted([], undefined).total).toBe(0);
  });

  it('drops the total through map and filter, because a derived list has no honest total', () => {
    const list = counted([1, 2, 3], 99);

    // Not a footgun — the number of rows the database holds for *that* query says nothing true
    // about a list somebody built from a subset of it.
    expect((list.filter((n) => n > 1) as Partial<{ total: number }>).total).toBeUndefined();
    expect(([...list] as Partial<{ total: number }>).total).toBeUndefined();
  });
});

describe('a real list', () => {
  let db: SupabaseClient;
  let organizationId: string;

  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `counted-${randomUUID().slice(0, 8)}@example.test`;
    const password = `pw-${randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;

    db = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signIn = await db.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;

    organizationId = await foundBusiness({ ownerEmail: email, name: 'Paged Ltd', currency: 'EUR' });

    for (const name of ['One', 'Two', 'Three']) {
      await createCustomer(db, { organizationId, name });
    }
  });

  it('says how many there are, not just how many it fetched', async () => {
    const list = await listCustomers(db, { organizationId, limit: 2 });

    // **This is the bug, reproduced deliberately.** Before the limit was explicit, a caller in
    // this position got a short list and no way to know it was short — the number it would have
    // reported is the one on the left, and the truth is the one on the right.
    expect(list).toHaveLength(2);
    expect(list.total).toBe(3);
  });

  it('reports the same number twice when there is nothing missing', async () => {
    const list = await listCustomers(db, { organizationId });

    expect(list).toHaveLength(3);
    expect(list.total).toBe(3);
    // Which is what makes *Showing 500 of 1,432* appear only when it is true: the screens test
    // `total > length`, so an ordinary business never sees the sentence at all.
    expect(list.total > list.length).toBe(false);
  });

  it('reads a list this codebase chose rather than one PostgREST imposed', () => {
    // The alternative to an explicit limit was never "no limit" — it was the vendor's thousand,
    // applied silently. Asserted so that removing the limit reads as the change it is.
    expect(LIST_LIMIT).toBeLessThan(1000);
  });
});
