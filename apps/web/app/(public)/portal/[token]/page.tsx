import { DividedList, EmptyState, Section, SectionHeading } from '@/components/containers/section';
import { notFound } from 'next/navigation';
import { BrandStyle } from '@/features/branding/brand-style';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { PublicHeader } from '@/features/public-profile/public-header';
import { getBrand, logoUrl } from '@/lib/domain/branding/brand';
import { getDb } from '@/lib/db/server';
import { invoiceStanding, listInvoiceLines, listPayments } from '@/lib/domain/billing/invoices';
import { claimPortalInvite } from '@/lib/domain/portal/portal';
import { DomainError } from '@/lib/domain/errors';
import { formatWindow, parseWindow } from '@/lib/domain/scheduling/window';
import { publicProfile } from '@/lib/domain/tenancy/profile';
import { formatMoney } from '@/lib/domain/work-items/consumption';

export const dynamic = 'force-dynamic';

/**
 * A customer's own history with one business.
 *
 * **D22's second surface, and it paid for nothing.** The axis was decided and built by booking;
 * this reads through the same policies with the same scope function. The only thing the portal
 * added is `external_actors.customer_id` — the column D22 predicted it would need — written by
 * one privileged function on presentation of the token in this URL.
 *
 * **The token is the credential and the page does not pretend otherwise.** Anyone holding the
 * link is this customer; it is the security model of a link to a shared document, and the
 * business revokes it. Proving control of an email address would need a channel, and channels
 * are M6's.
 *
 * Every word a reader sees that is not application state comes from `PublicHeader` — the
 * business's own copy — for the same reason the booking page carries none of the platform's.
 */
export default async function PortalPage({ params }: PageProps<'/portal/[token]'>) {
  const { token } = await params;
  const db = await getDb();

  let organizationId: string;
  try {
    organizationId = await claimPortalInvite(db, { token });
  } catch (error) {
    // An invalid link, a withdrawn one, and one belonging to a business this browser is
    // already booking with are all a 404. Telling them apart would let somebody holding a
    // revoked link learn that it had once been real.
    if (error instanceof DomainError) notFound();
    throw error;
  }

  const { data: organization } = await db
    .from('organizations')
    .select('name, timezone')
    .eq('id', organizationId)
    .maybeSingle();

  if (!organization) {
    notFound();
  }

  const [profile, items, invoices, brand] = await Promise.all([
    publicProfile(db, { organizationId, fallbackName: organization.name }),
    db
      .from('work_items')
      .select(
        'id, title, scheduled_during, status:work_item_statuses!work_items_status_same_org_and_type (name)',
      )
      .order('created_at', { ascending: false }),
    db.from('invoices').select('id, number, currency, issued_at').order('issued_at', {
      ascending: false,
    }),
    getBrand(db, { organizationId }),
  ]);

  // The standing of each invoice, from the one calculation. Read per invoice rather than in
  // aggregate because `invoiceStanding` takes what a caller has already read, and a customer
  // with three invoices is not a reporting problem.
  const standings = await Promise.all(
    (invoices.data ?? []).map(async (invoice) => {
      const [lines, payments] = await Promise.all([
        listInvoiceLines(db, { organizationId, invoiceId: invoice.id }),
        listPayments(db, { organizationId, invoiceId: invoice.id }),
      ]);
      return { invoice, standing: invoiceStanding({ lines, payments }) };
    }),
  );

  return (
    // `data-brand` scopes the roles `BrandStyle` writes. A public page is the surface a brand
    // is most for: this is the page a business puts on the side of a van.
    <main data-brand className="mx-auto w-full max-w-xl p-6 sm:p-8">
      <BrandStyle brand={brand} />
      <PublicHeader
        profile={profile}
        logoUrl={brand.logoPath ? logoUrl(db, brand.logoPath) : null}
      />

      <Section className="mt-8">
        <SectionHeading>Your work</SectionHeading>

        <div className="mt-2">
          <DataTable
            rows={(items.data ?? []).map((item) => ({
              id: item.id as string,
              title: item.title as string,
              window: parseWindow(item.scheduled_during as string | null),
              status: Array.isArray(item.status) ? item.status[0] : item.status,
            }))}
            rowKey={(item) => item.id}
            empty="Nothing recorded yet."
            columns={[
              { key: 'title', header: 'Work', emphasis: 'primary', cell: (item) => item.title },
              {
                key: 'status',
                header: 'Stage',
                // The tenant's own word for the state, rendered as written (D6) and coloured
                // by nothing — a customer is the last person who should be told by a colour
                // that their job is in trouble.
                cell: (item) => (item.status?.name ? <Badge>{item.status.name}</Badge> : null),
              },
              {
                key: 'when',
                header: 'When',
                cell: (item) =>
                  item.window ? (
                    <span className="tabular-nums">
                      {formatWindow(item.window, organization.timezone)}
                    </span>
                  ) : null,
              },
            ]}
          />
        </div>
      </Section>

      <Section className="mt-8">
        <SectionHeading>Your invoices</SectionHeading>

        {standings.length === 0 ? (
          <EmptyState weight="subtle" className="mt-1">Nothing invoiced yet.</EmptyState>
        ) : (
          <DividedList className="mt-2">
            {standings.map(({ invoice, standing }) => (
              <li key={invoice.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span>
                  #{invoice.number}
                  <span className="text-subtle">
                    {' '}
                    {new Intl.DateTimeFormat('en-GB', {
                      dateStyle: 'medium',
                      timeZone: organization.timezone,
                    }).format(new Date(invoice.issued_at))}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">
                  {standing.total ? formatMoney(standing.total.totalMinor, standing.total.currency) : '—'}
                  {/* Settled is arithmetic over payments, never a column. */}
                  <span className="ml-2 text-muted">
                    {standing.settled
                      ? 'paid'
                      : standing.outstandingMinor !== null && standing.total
                        ? `${formatMoney(standing.outstandingMinor, standing.total.currency)} due`
                        : ''}
                  </span>
                </span>
              </li>
            ))}
          </DividedList>
        )}
      </Section>
    </main>
  );
}
