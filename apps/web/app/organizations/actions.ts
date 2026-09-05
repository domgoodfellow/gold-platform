'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { canDraftConfiguration } from '@/lib/domain/onboarding/proposals';
import { createOrganization } from '@/lib/domain/tenancy/organizations';
import { AREAS, areaHref } from '@/lib/navigation';

export type CreateBusinessState = { error: string | null };

/**
 * Make a business and go straight to setting it up.
 *
 * **The redirect is the point of the whole slice.** Somebody who has just made a business should
 * be looking at it a second later, not back on a list with one row.
 *
 * **Where it goes changed, and the destination is the argument.** It used to land on the first
 * operational area, which for a business thirty seconds old is an empty schedule: a screen that
 * is correct, blank, and says nothing about what to do next. A first screen should be the first
 * task. So it lands on guided setup — which is switched on at founding as of `20260904000001`,
 * for exactly this reason — where the first thing on the page is a box asking what the business
 * does. Nothing is done to the business there without somebody pressing Apply, so landing on it
 * commits them to nothing.
 *
 * **Unless this deployment cannot draft, in which case it does not.** With no drafting behind
 * it that screen correctly says so and points at the other screens (D31) — which is the right
 * thing for somebody who navigated there and the wrong first thing to show somebody who has
 * just made a business. Sending them to a screen whose only content is what it cannot do would
 * be D31's own failure inverted: not a switch that leads nowhere, but a landing that leads
 * somewhere empty.
 */
export async function createBusinessAction(
  _previous: CreateBusinessState,
  formData: FormData,
): Promise<CreateBusinessState> {
  const db = await getDb();

  let organizationId: string;

  try {
    organizationId = await createOrganization(db, {
      name: String(formData.get('name') ?? ''),
      displayName: String(formData.get('displayName') ?? ''),
      timezone: String(formData.get('timezone') ?? ''),
      // No currency: the form does not ask, because nothing here needs one yet. The pricing
      // screen asks at the moment an amount is first written down.
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  // Outside the try: `redirect` works by throwing, so catching around it would turn a successful
  // creation into an error message. The same shape every other redirecting action here uses.
  redirect(
    areaHref(organizationId, (await canDraftConfiguration()) ? 'setup' : AREAS[0].segment),
  );
}
