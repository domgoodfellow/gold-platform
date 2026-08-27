import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CustomFieldValues } from '@/components/custom-field-values';
import { getDb } from '@/lib/db/server';
import { listCustomers } from '@/lib/domain/customers/customers';
import { DomainError } from '@/lib/domain/errors';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listLocations } from '@/lib/domain/locations/locations';
import { listResources } from '@/lib/domain/resources/resources';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { getOrganization } from '@/lib/domain/tenancy/organizations';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { CreateStatusForm, CreateWorkItemForm } from './work-forms';

export const dynamic = 'force-dynamic';

export default async function WorkPage({
  params,
}: PageProps<'/organizations/[organizationId]/work'>) {
  const { organizationId } = await params;
  const db = await getDb();

  try {
    await requireActor(db);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'auth.required') {
      redirect('/sign-in');
    }
    throw error;
  }

  const organization = await getOrganization(db, organizationId);
  if (!organization) {
    notFound();
  }

  const [workItems, statuses, customers, locations, resources, definitions] = await Promise.all([
    listWorkItems(db, { organizationId }),
    listWorkItemStatuses(db, { organizationId }),
    listCustomers(db, { organizationId }),
    listLocations(db, { organizationId }),
    listResources(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'work_item' }),
  ]);

  const mayAdd = organization.capabilities.includes('work_item.create');
  const mayConfigure = organization.capabilities.includes('field.manage');

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/organizations" className="text-sm underline underline-offset-4 opacity-70">
        ← Organizations
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">Work</h1>
      <p className="text-sm opacity-70">{organization.name}</p>

      {/* Grouped by the tenant's own statuses, in the tenant's own order (D6). The platform
          has no opinion about what any of these columns mean. */}
      {statuses.map((status) => {
        const inStatus = workItems.filter((item) => item.status.id === status.id);
        return (
          <section key={status.id} className="mt-6">
            <h2 className="text-sm font-medium">
              {status.name}
              <span className="ml-2 opacity-60">{inStatus.length}</span>
            </h2>

            {inStatus.length === 0 ? (
              <p className="mt-1 text-sm opacity-60">Nothing here.</p>
            ) : (
              <ul className="mt-2 divide-y divide-black/10 dark:divide-white/15">
                {inStatus.map((item) => (
                  <li key={item.id} className="py-3">
                    <div className="font-medium">{item.title}</div>
                    {item.customer || item.location || item.resource ? (
                      <div className="text-sm opacity-70">
                        {[
                          item.customer?.label,
                          item.location?.label,
                          item.resource ? `→ ${item.resource.label}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    ) : null}
                    <CustomFieldValues definitions={definitions} custom={item.custom} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {/*
        Hiding either form is a courtesy, not the guard. `work_items_insert` requires
        work_item.create and `work_item_statuses_insert` requires field.manage, both in the
        database (constraints.md: hiding a UI element is not authorization).
      */}
      {mayAdd ? (
        <CreateWorkItemForm
          organizationId={organizationId}
          statuses={statuses}
          customers={customers.map((c) => ({ id: c.id, label: c.name }))}
          locations={locations.map((l) => ({ id: l.id, label: l.label }))}
          resources={resources.map((r) => ({ id: r.id, label: r.name }))}
          definitions={definitions}
        />
      ) : (
        <p className="mt-8 text-sm opacity-70">
          Your role, {organization.role}, cannot add work items here.
        </p>
      )}

      <section className="mt-10 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">Board statuses</h2>
        <p className="mt-1 text-sm opacity-70">
          {statuses.length === 0
            ? 'None yet. These are yours to name — the platform has no opinion.'
            : statuses.map((status) => status.name).join(' → ')}
        </p>

        {mayConfigure ? (
          <CreateStatusForm organizationId={organizationId} />
        ) : (
          <p className="mt-2 text-sm opacity-70">
            Your role, {organization.role}, cannot configure statuses here.
          </p>
        )}
      </section>
    </main>
  );
}
