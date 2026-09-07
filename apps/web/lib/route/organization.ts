import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { getDb } from '@/lib/db/server';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { getOrganization, type Organization } from '@/lib/domain/tenancy/organizations';

/**
 * The guard every screen inside one business runs. Every page calls this itself rather than
 * relying on its layout — Next reuses a layout across client navigations without re-rendering
 * it, so a page trusting its parent for authorization would be trusting a cache; RLS is the
 * real boundary. `cache` makes repeated calls within one request a single round trip.
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

    // Null covers "no such organization" and "not yours" indistinguishably — RLS simply
    // returns no row, and a caller must not be able to tell the two apart.
    const organization = await getOrganization(db, organizationId);
    if (!organization) {
      notFound();
    }

    return { db, organization };
  },
);
