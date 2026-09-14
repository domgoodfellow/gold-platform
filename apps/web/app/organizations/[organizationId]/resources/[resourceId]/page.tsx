import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RecordHeader } from '@/components/containers/record-header';
import { DividedList, EmptyState } from '@/components/containers/section';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { CustomFieldValues } from '@/features/custom-fields/values';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { getResource } from '@/lib/domain/resources/resources';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * A resource's own record — the minimum that stops it being an inert name.
 *
 * No edit form: nothing in the domain layer corrects a resource past its name today
 * (docs/ui-domain-coverage.md), so this page displays what exists rather than inventing a write
 * path. No documents section either — `resource` is not in `DOCUMENT_ENTITIES` at the schema
 * level, not just the UI, so adding one here would be a UI claim the database cannot back. No
 * Schedule or Activity tab for the same reason: no backing domain data exists for either yet.
 */
export default async function ResourcePage({
  params,
}: PageProps<'/organizations/[organizationId]/resources/[resourceId]'>) {
  const { organizationId, resourceId } = await params;
  const { db } = await requireOrganization(organizationId);

  // Another tenant's resource id resolves to null, so this renders a 404 rather than an empty
  // page — the same indistinguishability `getCustomer` and its siblings rely on RLS for.
  const resource = await getResource(db, { organizationId, resourceId });
  if (!resource) {
    notFound();
  }

  const [definitions, workItems] = await Promise.all([
    listFieldDefinitions(db, { organizationId, entityType: 'resource' }),
    listWorkItems(db, { organizationId, resourceId }),
  ]);

  return (
    <>
      <RecordHeader
        title={resource.name}
        crumbs={[
          { label: 'Resources', href: `/organizations/${organizationId}/resources` },
          { label: resource.name },
        ]}
      />

      <Tabs defaultValue="overview" className="mt-8">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="work">Work</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <CustomFieldValues definitions={definitions} custom={resource.custom} />
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
