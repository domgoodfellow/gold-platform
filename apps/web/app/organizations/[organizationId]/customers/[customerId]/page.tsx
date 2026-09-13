import { Hint } from '@/components/controls/inputs';
import { DefinitionList, Detail } from '@/components/display/data';
import { DividedList, EmptyState, PageHeading, Section, SectionHeading } from '@/components/containers/section';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CustomFieldValues } from '@/features/custom-fields/values';
import { DocumentsSection } from '@/features/documents/section';
import { ActivityList } from '@/features/timeline/activity-list';
import { EditCustomerForm } from '@/features/crm/customers/edit-customer-form';
import { CallCustomerForm } from '@/features/communications/voice/call-customer-form';
import { CallHistory } from '@/features/communications/voice/call-history';
import { invoiceStanding, listCustomerInvoices } from '@/lib/domain/billing/invoices';
import { getCustomer } from '@/lib/domain/customers/customers';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listCustomerCalls } from '@/lib/domain/reception/calls';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import { listDocuments } from '@/lib/domain/documents/documents';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { PortalLinkForm } from '@/features/portal-access/portal-link-form';
import { PortalInviteList } from '@/features/portal-access/invite-list';
import { listPortalInvites } from '@/lib/domain/portal/portal';
import { listCustomerTimeline } from '@/lib/domain/timeline/timeline';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import {
  createPortalInviteAction,
  revokePortalInviteAction,
  uploadCustomerDocumentAction,
} from './actions';
import { requireOrganization } from '@/lib/route/organization';
import { requestOrigin } from '@/lib/route/origin';

export const dynamic = 'force-dynamic';

export default async function CustomerPage({
  params,
}: PageProps<'/organizations/[organizationId]/customers/[customerId]'>) {
  const { organizationId, customerId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  // Another tenant's customer id resolves to null, so this renders a 404 rather than an
  // empty page. From this caller's position the customer genuinely does not exist.
  const customer = await getCustomer(db, { organizationId, customerId });
  if (!customer) {
    notFound();
  }

  const origin = await requestOrigin();
  const [documents, definitions, timeline, invites, modules, stages, calls, invoices] = await Promise.all([
    listDocuments(db, {
      organizationId,
      attachedTo: { entity: 'customer', id: customerId },
    }),
    listFieldDefinitions(db, { organizationId, entityType: 'customer' }),
    listCustomerTimeline(db, { organizationId, customerId }),
    listPortalInvites(db, { organizationId, customerId }),
    listUsableModules(db, { organizationId }),
    listCustomerStages(db, { organizationId }),
    listCustomerCalls(db, { organizationId, customerId }),
    listCustomerInvoices(db, { organizationId, customerId }),
  ]);

  const mayAttach = organization.capabilities.includes('document.create');
  const mayEdit = organization.capabilities.includes('customer.update');
  const mayCall = organization.capabilities.includes('call.place');
  // `customer_portal_invites_insert`/`_update` both check `customer.create` — inviting a
  // customer to their own portal is authorized as a fact about the customer relationship, not
  // as a document attachment. This used to read `mayAttach` because that variable already
  // existed nearby, which quietly meant a role could attach files but not manage portal access,
  // or the reverse, with nothing on screen saying so.
  const mayManagePortalAccess = organization.capabilities.includes('customer.create');
  // **The module hides more than its own area, which is what makes the switch real.** Reception
  // off takes the stage, the dialler and the call history off this screen too — the same rule
  // that makes switching billing off remove the quote and the invoice from a job.
  const reception = modules.has('reception');
  const portal = modules.has('portal');
  const billing = modules.has('billing');
  const stage = stages.find((entry) => entry.id === customer.stageId) ?? null;

  return (
    <>
      <Link
        href={`/organizations/${organizationId}/customers`}
        className="text-sm underline underline-offset-4 text-muted"
      >
        ← Customers
      </Link>

      <PageHeading className="mt-4">{customer.name}</PageHeading>

      {/* Labelled and one per line, because an address and a number are two things somebody
          copies separately — and a middle dot between them is picked up by a double-click. */}
      <DefinitionList className="mt-3">
        <Detail label="Email">
          {customer.email ? (
            <a href={`mailto:${customer.email}`} className="underline underline-offset-4">
              {customer.email}
            </a>
          ) : null}
        </Detail>
        <Detail label="Phone">
          {customer.phone ? (
            <a href={`tel:${customer.phone}`} className="underline underline-offset-4">
              {customer.phone}
            </a>
          ) : null}
        </Detail>
      </DefinitionList>
      {reception && stage ? (
        <p className="mt-3 text-sm text-muted">Stage: {stage.name}</p>
      ) : null}

      <CustomFieldValues definitions={definitions} custom={customer.custom} />

      {mayEdit ? (
        <Section className="mt-10">
          <SectionHeading>Details</SectionHeading>
          <EditCustomerForm
            organizationId={organizationId}
            customer={customer}
            definitions={definitions}
            // Empty when reception is off, which makes the selector disappear rather than offer
            // a pipeline this business is not running.
            stages={reception ? stages : []}
          />
        </Section>
      ) : (
        <Hint className="mt-10">
          Your role, {organization.role}, cannot change a customer&apos;s details.
        </Hint>
      )}

      {reception ? (
        <Section className="mt-10">
          <SectionHeading>Calls</SectionHeading>

          <div className="mt-2">
            <CallHistory calls={calls} empty="No calls with this customer." />
          </div>

          {/* Hiding it is a courtesy, not the guard: `calls_insert` requires call.place in the
              database, so a caller reaching the action anyway is refused there (I12). */}
          {mayCall ? (
            <CallCustomerForm
              organizationId={organizationId}
              customerId={customerId}
              phone={customer.phone}
            />
          ) : (
            <Hint className="mt-2">
              Your role, {organization.role}, cannot call customers.
            </Hint>
          )}
        </Section>
      ) : null}

      <DocumentsSection
        organizationId={organizationId}
        documents={documents}
        mayAttach={mayAttach}
        roleLabel={organization.role}
        uploadAction={uploadCustomerDocumentAction}
        hiddenFields={{ organizationId, customerId }}
      />

      {/* The same rule Reception follows above: switching billing off already removes the quote,
          invoice and margin sections from every job screen (M4) — this is that rule's second
          caller, not a new interpretation of it. */}
      {billing ? (
        <Section className="mt-8">
          <SectionHeading>Invoices</SectionHeading>

          {invoices.length === 0 ? (
            <EmptyState className="mt-2">Nothing invoiced yet.</EmptyState>
          ) : (
            <DividedList className="mt-2">
              {invoices.map((invoice) => {
                const standing = invoiceStanding(invoice);
                return (
                  <li key={invoice.id} className="flex flex-col gap-1 py-2 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <Link
                        href={`/organizations/${organizationId}/work/${invoice.workItemId}`}
                        className="font-medium underline underline-offset-4"
                      >
                        Invoice #{invoice.number}
                      </Link>
                      <span className="shrink-0 text-subtle">
                        {new Intl.DateTimeFormat('en-GB', {
                          dateStyle: 'medium',
                          timeZone: organization.timezone,
                        }).format(new Date(invoice.issuedAt))}
                        {invoice.dueAt
                          ? ` · due ${new Intl.DateTimeFormat('en-GB', {
                              dateStyle: 'medium',
                              timeZone: organization.timezone,
                            }).format(new Date(invoice.dueAt))}`
                          : ''}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 text-muted">
                      <span>{standing.settled ? 'Settled' : 'Outstanding'}</span>
                      <span className="shrink-0 tabular-nums">
                        {standing.total
                          ? formatMoney(standing.total.totalMinor, standing.total.currency)
                          : '—'}
                        {!standing.settled && standing.outstandingMinor !== null && standing.total
                          ? ` (${formatMoney(standing.outstandingMinor, standing.total.currency)} due)`
                          : null}
                      </span>
                    </div>
                  </li>
                );
              })}
            </DividedList>
          )}
        </Section>
      ) : null}

      {/* The same rule Reception follows above: a module off takes its section off this screen
          too, not just its own area (constraints.md — "a colour keyed to what a status means"
          sibling rule, restated for modules). */}
      {portal ? (
        <Section className="mt-8">
          <SectionHeading>Portal</SectionHeading>
          <Hint className="mt-1">
            A link this customer can open to see their own work and invoices. Anyone holding it is
            them, so send it the way you would send a document — and withdraw it if it goes
            astray.
          </Hint>

          {mayManagePortalAccess ? (
            <>
              <PortalLinkForm
                organizationId={organizationId}
                customerId={customerId}
                origin={origin}
                createAction={createPortalInviteAction}
              />
              <PortalInviteList
                organizationId={organizationId}
                customerId={customerId}
                invites={invites}
                origin={origin}
                revokeAction={revokePortalInviteAction}
              />
            </>
          ) : (
            <Hint className="mt-3">
              Your role, {organization.role}, cannot manage this customer&apos;s portal access.
            </Hint>
          )}
        </Section>
      ) : null}

      <Section className="mt-8">
        <SectionHeading>History</SectionHeading>
        {/* The first screen that reads `events`. Not capability-gated, and deliberately: the
            table is append-only and every row on it is already restricted by RLS to this
            tenant, so there is nothing here a member of this business may not see. */}
        <ActivityList timeline={timeline} timezone={organization.timezone} />
      </Section>
    </>
  );
}
