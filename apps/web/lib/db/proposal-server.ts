import { cookies } from 'next/headers';
import type { Db } from './types';
import { createProposalClient } from './proposal';

/** The request-scoped proposal client, for Server Components and Server Actions. */
export async function getProposalDb(): Promise<Db> {
  const store = await cookies();
  return createProposalClient({
    getAll: () => store.getAll(),
    setAll: (toSet) => {
      try {
        for (const { name, value, options } of toSet) store.set(name, value, options);
      } catch {
        // A Server Component cannot write a cookie; the proxy refreshes this session before the
        // route renders, exactly as it does for the portal.
      }
    },
  });
}
