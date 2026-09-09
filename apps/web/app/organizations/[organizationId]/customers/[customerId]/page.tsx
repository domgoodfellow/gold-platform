import { Hint } from '@/components/controls/inputs';
import { DefinitionList, Detail } from '@/components/display/data';
import { DividedList, EmptyState, PageHeading, Section, SectionHeading } from '@/components/containers/section';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CustomFieldValues } from '@/components/custom-fields/values';
import { getCustomer } from '@/lib/domain/customers/customers';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listCustomerCalls } from '@/lib/domain/reception/calls';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import { listDocuments } from '@/lib/domain/documents/documents';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { PortalLinkForm } from '@/features/public-profile/portal-link-form';
import { listPortalInvites } from '@/lib/domain/portal/portal';
import { listCustomerTimeline } from '@/lib/domain/timeline/timeline';
import { createPortalInviteAction } from './actions';
import { requireOrganization } from '@/lib/route/organization';
import { UploadDocumentForm } from './upload-document-form';
import { CallCustomerForm, EditCustomerForm } from './customer-forms';

export const dynamic = 'force-dynamic';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

  const [documents, definitions, timeline, invites, modules, stages, calls] = await Promise.all([
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
  ]);

  const mayAttach = organization.capabilities.includes('document.create');
  const mayEdit = organization.capabilities.includes('customer.update');
  const mayCall = organization.capabilities.includes('call.place');
  // **The module hides more than its own area, which is what makes the switch real.** Reception
  // off takes the stage, the dialler and the call history off this screen too — the same rule
  // that makes switching billing off remove the quote and the invoice from a job.
  const reception = modules.has('reception');
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

          {calls.length === 0 ? (
            <EmptyState className="mt-2">No calls with this customer.</EmptyState>
          ) : (
            <DividedList className="mt-2">
              {calls.map((call) => (
                <li key={call.id} className="py-3">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">
                      {call.direction === 'inbound' ? 'Inbound' : 'Outbound'}
                    </span>
                    <span className="text-sm text-muted">
                      {[
                        call.toNumber,
                        call.status.replace('_', ' '),
                        call.durationSeconds === null ? null : `${call.durationSeconds}s`,
                        call.outcome?.name ?? null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  {call.note ? <p className="mt-1 text-sm">{call.note}</p> : null}
                </li>
              ))}
            </DividedList>
          )}

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

      <Section className="mt-10">
        <SectionHeading>Documents</SectionHeading>

        {documents.length === 0 ? (
          <EmptyState className="mt-2">Nothing attached yet.</EmptyState>
        ) : (
          <DividedList className="mt-2">
            {documents.map((document) => (
              <li key={document.id} className="flex items-baseline justify-between py-3">
                <div>
                  {/*
                    Points at our own route, never at storage. The signed URL is minted when
                    this is clicked and lives sixty seconds; a link to storage rendered into
                    this page would be the durable URL constraints.md forbids.
                  */}
                  <a
                    href={`/organizations/${organizationId}/documents/${document.id}/download`}
                    className="font-medium underline underline-offset-4"
                  >
                    {document.fileName}
                  </a>
                  <div className="text-sm text-muted">
                    {[document.mimeType, formatSize(document.sizeBytes)].join(' · ')}
                  </div>
                </div>
              </li>
            ))}
          </DividedList>
        )}

        {mayAttach ? (
          <UploadDocumentForm organizationId={organizationId} customerId={customerId} />
        ) : (
          <Hint className="mt-4">
            Your role, {organization.role}, cannot attach documents here.
          </Hint>
        )}
      </Section>

      <Section className="mt-8">
        <SectionHeading>Portal</SectionHeading>
        <Hint className="mt-1">
          A link this customer can open to see their own work and invoices. Anyone holding it is
          them, so send it the way you would send a document — and withdraw it if it goes
          astray.
        </Hint>

        {mayAttach ? (
          <PortalLinkForm
            organizationId={organizationId}
            customerId={customerId}
            origin=""
            createAction={createPortalInviteAction}
          />
        ) : (
          <Hint className="mt-3">
            Your role, {organization.role}, cannot invite customers here.
          </Hint>
        )}

        {invites.length > 0 ? (
          <Hint weight="subtle" className="mt-3 text-xs">
            {invites.filter((invite) => invite.revokedAt === null).length} active,{' '}
            {invites.filter((invite) => invite.revokedAt !== null).length} withdrawn.
          </Hint>
        ) : null}
      </Section>

      <Section className="mt-8">
        <SectionHeading>History</SectionHeading>
        {/* The first screen that reads `events`. Not capability-gated, and deliberately: the
            table is append-only and every row on it is already restricted by RLS to this
            tenant, so there is nothing here a member of this business may not see. */}

        {timeline.length === 0 ? (
          <EmptyState weight="subtle" className="mt-1">Nothing recorded yet.</EmptyState>
        ) : (
          <DividedList as="ol" className="mt-2">
            {timeline.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-3">
                {/* The instant, in this business's zone (I9). `formatWindow` takes a range and
                    this is a moment, so the same rule is applied with the same zone rather
                    than a second formatter deciding for itself. */}
                <time
                  dateTime={entry.occurredAt}
                  className="shrink-0 text-xs tabular-nums text-subtle sm:w-40 sm:pt-0.5"
                >
                  {new Intl.DateTimeFormat('en-GB', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: organization.timezone,
                  }).format(new Date(entry.occurredAt))}
                </time>
                <div className="min-w-0 text-sm">
                  <div>{entry.description}</div>
                  {/* I11 is an actor id; a name is what this tenant chose to call them, and
                      somebody who has left the business no longer has one (D19). */}
                  <div className="text-xs text-subtle">{entry.actorName ?? 'A former member'}</div>
                </div>
              </li>
            ))}
          </DividedList>
        )}
      </Section>
    </>
  );
}
