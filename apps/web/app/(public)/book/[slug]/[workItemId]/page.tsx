import { Hint } from '@/components/controls/inputs';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { PublicHeader } from '@/features/public-profile/public-header';
import { resolveBookingSlug } from '@/lib/domain/booking/booking';
import { publicProfile } from '@/lib/domain/tenancy/profile';
import { listPricedLines, priceWorkItem } from '@/lib/domain/pricing/prices';
import { formatWindow, parseWindow } from '@/lib/domain/scheduling/window';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { ButtonLink } from '@/components/controls/button';
import { getBookingChangeOptions } from '@/lib/domain/booking/changes';
import { describeBookingPolicyReason } from '@/lib/domain/booking/policy';
import { CancelBookingControl } from './change-controls';

export const dynamic = 'force-dynamic';

/**
 * What a visitor sees after booking, and the first read-back on D22's axis.
 *
 * Every row here is reached by exactly one permission check: `created_by = auth.uid()` under
 * the external policies. There is no token in the URL to guess and no capability to hold — a
 * work item id that is not theirs simply does not exist from out here, which is why this is a
 * 404 rather than a refusal.
 *
 * The price is `priceWorkItem` (I4), reading the lines the booking copied from the catalogue.
 * A stranger seeing what they were quoted is the same total the operator sees, from the same
 * function, because there is only one.
 */
export default async function BookingConfirmationPage({
  params,
}: PageProps<'/book/[slug]/[workItemId]'>) {
  const { slug, workItemId } = await params;
  const db = await getDb();

  const organizationId = await resolveBookingSlug(db, slug);
  if (!organizationId) {
    notFound();
  }

  const [organization, item] = await Promise.all([
    db.from('organizations').select('name, timezone').eq('id', organizationId).maybeSingle(),
    db
      .from('work_items')
      .select('id, title, scheduled_during, status:work_item_statuses!work_items_status_same_org_and_type (name)')
      .eq('id', workItemId)
      .maybeSingle(),
  ]);

  if (!organization.data || !item.data) {
    notFound();
  }

  const profile = await publicProfile(db, {
    organizationId,
    fallbackName: organization.data.name,
  });

  const options = await getBookingChangeOptions(db, { workItemId });
  const window = parseWindow(item.data.scheduled_during as string | null);
  const lines = await listPricedLines(db, { organizationId, workItemId });
  const price = priceWorkItem(lines);
  const status = Array.isArray(item.data.status) ? item.data.status[0] : item.data.status;

  return (
    <main className="mx-auto w-full max-w-xl p-6 sm:p-8">
      <PublicHeader profile={profile} />
      {/* Application state — what just happened — rather than anything the business claims. */}
      <p className="mt-6 text-sm font-medium">{options?.rescheduleRefusal === 'booking_not_active' ? 'Your booking has been cancelled.' : 'Your booking is confirmed.'}</p>

      <dl className="mt-8 flex flex-col gap-3 text-sm">
        <div>
          <dt className="text-subtle">What</dt>
          <dd className="font-medium">{item.data.title}</dd>
        </div>
        {window ? (
          <div>
            <dt className="text-subtle">When</dt>
            {/* I9: an absolute instant, rendered in the business's zone rather than the
                reader's — the appointment is at the shop's clock, wherever the phone is. */}
            <dd className="font-medium">{formatWindow(window, organization.data.timezone)}</dd>
          </div>
        ) : null}
        {status ? (
          <div>
            <dt className="text-subtle">Status</dt>
            {/* The tenant's own word, rendered as written. The platform does not know what it
                means and never translates it (D6). */}
            <dd className="font-medium">{status.name}</dd>
          </div>
        ) : null}
        {price ? (
          <div>
            <dt className="text-subtle">Price</dt>
            <dd className="font-medium">{formatMoney(price.totalMinor, price.currency)}</dd>
          </div>
        ) : null}
      </dl>

      {/* What the customer may still do themselves, as the business's own limits allow it — said
          once, from the database's answer, never worked out here. */}
      {options ? (
        <section aria-label="Change this booking" className="mt-8 flex flex-col gap-3">
          {options.canReschedule ? (
            <ButtonLink tone="secondary" href={`/book/${slug}/${workItemId}/reschedule`} className="w-fit">Reschedule</ButtonLink>
          ) : null}
          {options.canCancel ? <CancelBookingControl slug={slug} workItemId={workItemId} /> : null}
          {!options.canReschedule && !options.canCancel && options.rescheduleRefusal !== 'booking_not_active' ? (
            <Hint>
              {options.rescheduleRefusal ? describeBookingPolicyReason(options.rescheduleRefusal) : 'To change this booking, please contact the business.'}
            </Hint>
          ) : null}
        </section>
      ) : null}

      <Hint weight="subtle" className="mt-10 text-xs">Keep this page to check your booking.</Hint>
    </main>
  );
}
