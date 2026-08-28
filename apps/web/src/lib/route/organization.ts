import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { getDb } from '@/lib/db/server';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { getOrganization, type Organization } from '@/lib/domain/tenancy/organizations';

/**
 * The guard every screen inside one business runs, and the answer it needs to render.
 *
 * This was written out longhand in eleven pages — identical `requireActor` try/catch,
 * identical `getOrganization`, identical `notFound()`. `constraints.md` says that when a
 * second caller needs a rule that is inline, extract it first and then call it twice; there
 * were eleven, and the shell made a twelfth. Copying it once more was not an option.
 *
 * **It stays a guard in every caller, not only in the layout.** A layout is server-side and
 * does run, but Next reuses a layout across client-side navigations without re-rendering it,
 * so a page that leaned on its parent for authorization would be trusting a cache. That is
 * the same reasoning that keeps `requireActor` in the pages even though `src/proxy.ts`
 * already turned anonymous callers away: a redirect is not the authorization boundary, and
 * neither is a layout (constraints.md, Security). RLS is. These two produce the error
 * message and the 404.
 *
 * `cache` makes the twelve calls one round trip per request rather than twelve, which is why
 * the layout and its page can both ask without either having to pass the answer down.
 *
 * Nothing here decides anything a business would recognise as a rule. It resolves an actor,
 * reads one row under RLS, and turns absence into a 404 — the domain layer owns the read,
 * and Next owns `redirect` and `notFound`, which is the only reason this is not in
 * `lib/domain`.
 */
export const requireOrganization = cache(
  async (organizationId: string): Promise<{ db: Db; organization: Organization }> => {
    const db = await getDb();

    try {
      await requireActor(db);
    } catch (error) {
      if (error instanceof DomainError && error.code === 'auth.required') {
        redirect('/sign-in');
      }
      throw error;
    }

    // Null covers "no such organization" and "not yours" indistinguishably, because RLS
    // simply does not return the row. `notFound()` preserves that: a caller cannot tell a
    // typo from someone else's tenant, and nothing here tries to.
    const organization = await getOrganization(db, organizationId);
    if (!organization) {
      notFound();
    }

    return { db, organization };
  },
);
