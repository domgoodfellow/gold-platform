import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RecordHeader } from '@/components/headers/record-header';
import { DividedList, EmptyState } from '@/components/surfaces/section';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { CustomFieldValues } from '@/features/custom-fields/values';
import { availableMembers } from '@/features/resources/member-options';
import { ResourceCapabilitiesControl } from '@/features/resources/resource-capabilities-control';
import { ResourceClassControl } from '@/features/resources/resource-class-control';
import { ResourceExceptionsPanel } from '@/features/resources/resource-exceptions-panel';
import { ResourceMembershipControl } from '@/features/resources/resource-membership-control';
import { ResourceWorkingHoursEditor } from '@/features/resources/resource-working-hours-editor';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listResourceCapabilities } from '@/lib/domain/resources/resource-capabilities';
import { RESOURCE_CLASS_LABELS } from '@/lib/domain/resources/resource-class';
import { getResource, listResources } from '@/lib/domain/resources/resources';
import {
  getResourceWorkingHours,
  listAvailabilityConflicts,
  listResourceAvailabilityExceptions,
} from '@/lib/domain/scheduling/resource-availability';
import { formatWindow } from '@/lib/domain/scheduling/window';
import { listMembers } from '@/lib/domain/tenancy/members';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * A resource's own record — the minimum that stops it being an inert name.
 *
 * The one correction the domain layer supports today is which Membership this Resource
 * represents (Slice 0B) — `resource.update`-gated, shown as a control only to a caller who
 * holds it, and as plain text otherwise (I12: hiding is a courtesy, RLS is the guard). No
 * documents section — `resource` is not in `DOCUMENT_ENTITIES` at the schema level, not just
 * the UI, so adding one here would be a UI claim the database cannot back. No Schedule or
 * Activity tab for the same reason: no backing domain data exists for either yet.
 */
export default async function ResourcePage({
  params,
}: PageProps<'/organizations/[organizationId]/resources/[resourceId]'>) {
  const { organizationId, resourceId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  // Another tenant's resource id resolves to null, so this renders a 404 rather than an empty
  // page — the same indistinguishability `getCustomer` and its siblings rely on RLS for.
  const resource = await getResource(db, { organizationId, resourceId });
  if (!resource) {
    notFound();
  }

  const now = new Date();
  const ahead = { startsAt: now.toISOString(), endsAt: new Date(now.getTime() + 400 * 86_400_000).toISOString() };
  const [definitions, workItems, members, resources, vocabulary, workingHours, exceptions, conflicts] = await Promise.all([
    listFieldDefinitions(db, { organizationId, entityType: 'resource' }),
    listWorkItems(db, { organizationId, resourceId }),
    listMembers(db, { organizationId }),
    listResources(db, { organizationId }),
    listResourceCapabilities(db, { organizationId }),
    getResourceWorkingHours(db, { organizationId, resourceId }),
    listResourceAvailabilityExceptions(db, { organizationId, resourceId, endingAfter: now.toISOString() }),
    listAvailabilityConflicts(db, { organizationId, within: ahead }),
  ]);
  const affected = new Set(
    conflicts.filter((conflict) => conflict.resourceId === resourceId).map((conflict) => conflict.workItemId),
  );
  const affectedWork = workItems.filter((item) => affected.has(item.id));

  const mayUpdate = organization.capabilities.includes('resource.update');
  const mayConfigure = organization.capabilities.includes('field.manage');
  const heldIds = new Set(resource.capabilities.map((capability) => capability.id));
  const memberOptions = availableMembers(members, resources, { excludeResourceId: resourceId });

  return (
    <>
      <RecordHeader
        title={resource.name}
        crumbs={[
          { label: 'Resources', href: `/organizations/${organizationId}/resources` },
          { label: resource.name },
        ]}
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="availability">Availability</TabsTrigger>
          <TabsTrigger value="work">Work</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 flex flex-col gap-6">
          <div>
            <div className="text-sm font-medium text-muted">Type</div>
            {mayUpdate ? (
              <ResourceClassControl organizationId={organizationId} resourceId={resourceId} current={resource.resourceClass} />
            ) : (
              <div>{RESOURCE_CLASS_LABELS[resource.resourceClass]}</div>
            )}
          </div>
          <div>
            <div className="text-sm font-medium text-muted">Capabilities</div>
            <ResourceCapabilitiesControl
              organizationId={organizationId}
              resourceId={resourceId}
              resourceName={resource.name}
              held={resource.capabilities}
              available={vocabulary.filter((capability) => !heldIds.has(capability.id))}
              mayChange={mayUpdate}
              mayAddWord={mayConfigure}
            />
          </div>
          {/* Only a person can represent a member, so the control exists for that class alone. */}
          {resource.resourceClass === 'person' ? (
            <div>
              <div className="text-sm font-medium text-muted">Represents member</div>
              {mayUpdate ? (
                <ResourceMembershipControl
                  organizationId={organizationId}
                  resourceId={resourceId}
                  currentMembershipId={resource.member?.membershipId ?? null}
                  availableMembers={memberOptions}
                />
              ) : (
                <div>{resource.member ? resource.member.displayName : 'None — not a member'}</div>
              )}
            </div>
          ) : null}
          <CustomFieldValues definitions={definitions} custom={resource.custom} />
        </TabsContent>

        <TabsContent value="availability" className="mt-6 flex flex-col gap-8">
          <section aria-labelledby="working-hours-heading" className="flex flex-col gap-3">
            <h2 id="working-hours-heading" className="text-base font-semibold">Availability</h2>
            <ResourceWorkingHoursEditor
              organizationId={organizationId}
              resourceId={resourceId}
              resourceName={resource.name}
              timezone={organization.timezone}
              initial={workingHours}
              mayChange={mayUpdate}
            />
          </section>
          <section aria-labelledby="exceptions-heading" className="flex flex-col gap-3">
            <h2 id="exceptions-heading" className="text-base font-semibold">Time off &amp; exceptions</h2>
            <ResourceExceptionsPanel
              organizationId={organizationId}
              resourceId={resourceId}
              timezone={organization.timezone}
              exceptions={exceptions}
              mayChange={mayUpdate}
            />
          </section>
          {affectedWork.length > 0 ? (
            <section aria-labelledby="affected-heading" className="flex flex-col gap-2">
              <h2 id="affected-heading" className="text-base font-semibold">Scheduled work outside this availability</h2>
              <p className="text-sm text-muted">These jobs were booked before the hours or time off above. Nothing has been moved.</p>
              <DividedList>
                {affectedWork.map((item) => (
                  <li key={item.id} className="py-2">
                    <Link href={`/organizations/${organizationId}/work/${item.id}`} className="font-medium underline underline-offset-4">
                      {item.title}
                    </Link>
                    <div className="text-sm text-muted">
                      {item.window ? formatWindow(item.window, organization.timezone) : ''}
                    </div>
                  </li>
                ))}
              </DividedList>
            </section>
          ) : null}
        </TabsContent>

        <TabsContent value="work" className="mt-6">
          {workItems.length === 0 ? (
            <EmptyState className="mt-2">No work scheduled against this resource.</EmptyState>
          ) : (
            <DividedList className="mt-2">
              {workItems.map((item) => (
                <li key={item.id} className="py-2">
                  <Link
                    href={`/organizations/${organizationId}/work/${item.id}`}
                    className="font-medium underline underline-offset-4"
                  >
                    {item.title}
                  </Link>
                  <div className="text-sm text-muted">{item.status.label}</div>
                </li>
              ))}
            </DividedList>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
