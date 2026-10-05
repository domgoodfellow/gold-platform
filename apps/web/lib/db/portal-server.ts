import { cookies } from 'next/headers';
import type { Db } from './types';
import { createPortalClient } from './portal';

/** The request-scoped portal client, for Server Components and Server Actions. */
export async function getPortalDb(): Promise<Db> {
  const store = await cookies();
  return createPortalClient({
    getAll: () => store.getAll(),
    setAll: (toSet) => {
      try {
        for (const { name, value, options } of toSet) store.set(name, value, options);
      } catch {
        // A Server Component cannot write a cookie; the proxy refreshes this session before the
        // route renders, exactly as it does for the account session.
      }
    },
  });
}
