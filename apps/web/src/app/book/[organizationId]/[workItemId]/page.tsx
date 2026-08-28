import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { listPricedLines, priceWorkItem } from '@/lib/domain/pricing/prices';
import { formatWindow, parseWindow } from '@/lib/domain/scheduling/window';
import { formatMoney } from '@/lib/domain/work-items/consumption';

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
}: PageProps<'/book/[organizationId]/[workItemId]'>) {
  const { organizationId, workItemId } = await params;
  const db = await getDb();

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

  const window = parseWindow(item.data.scheduled_during as string | null);
  const lines = await listPricedLines(db, { organizationId, workItemId });
  const price = priceWorkItem(lines);
  const status = Array.isArray(item.data.status) ? item.data.status[0] : item.data.status;

  return (
    <main className="mx-auto max-w-xl p-6 sm:p-8">
      <h1 className="text-2xl font-semibold">Booked</h1>
      <p className="mt-1 text-sm opacity-70">{organization.data.name}</p>

      <dl className="mt-8 flex flex-col gap-3 text-sm">
        <div>
          <dt className="opacity-60">What</dt>
          <dd className="font-medium">{item.data.title}</dd>
        </div>
        {window ? (
          <div>
            <dt className="opacity-60">When</dt>
            {/* I9: an absolute instant, rendered in the business's zone rather than the
                reader's — the appointment is at the shop's clock, wherever the phone is. */}
            <dd className="font-medium">{formatWindow(window, organization.data.timezone)}</dd>
          </div>
        ) : null}
        {status ? (
          <div>
            <dt className="opacity-60">Status</dt>
            {/* The tenant's own word, rendered as written. The platform does not know what it
                means and never translates it (D6). */}
            <dd className="font-medium">{status.name}</dd>
          </div>
        ) : null}
        {price ? (
          <div>
            <dt className="opacity-60">Price</dt>
            <dd className="font-medium">{formatMoney(price.totalMinor, price.currency)}</dd>
          </div>
        ) : null}
      </dl>

      <p className="mt-10 text-xs opacity-60">
        Keep this page to check your booking. This business will be in touch if anything
        changes.
      </p>
    </main>
  );
}
