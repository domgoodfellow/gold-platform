import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CustomFieldValues } from '@/components/custom-field-values';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listResources } from '@/lib/domain/resources/resources';
import { formatWindow } from '@/lib/domain/scheduling/window';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { getOrganization } from '@/lib/domain/tenancy/organizations';
import { listChecklistItems } from '@/lib/domain/work-items/checklists';
import { formatMoney, listCosts, listTimeEntries } from '@/lib/domain/work-items/consumption';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import {
  AddChecklistItemForm,
  RecordCostForm,
  RecordTimeForm,
  ToggleChecklistItemForm,
} from './work-item-forms';

export const dynamic = 'force-dynamic';

/** One job: what it involves, what it took, and what it cost. */
export default async function WorkItemPage({
  params,
}: PageProps<'/organizations/[organizationId]/work/[workItemId]'>) {
  const { organizationId, workItemId } = await params;
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

  const workItems = await listWorkItems(db, { organizationId });
  const workItem = workItems.find((item) => item.id === workItemId);
  // Absent rather than forbidden: RLS has already decided, and from here a work item in
  // another tenant genuinely does not exist.
  if (!workItem) {
    notFound();
  }

  const [checklist, timeEntries, costs, resources, definitions] = await Promise.all([
    listChecklistItems(db, { organizationId, workItemId }),
    listTimeEntries(db, { organizationId, workItemId }),
    listCosts(db, { organizationId, workItemId }),
    listResources(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'work_item' }),
  ]);

  const mayAdd = organization.capabilities.includes('work_item.create');
  const mayTick = organization.capabilities.includes('work_item.transition');
  const mayRecord = organization.capabilities.includes('work_item.record');

  const resourceName = new Map(resources.map((resource) => [resource.id, resource.name]));
  const nextPosition = checklist.reduce((highest, item) => Math.max(highest, item.position), -1) + 1;

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link
        href={`/organizations/${organizationId}/work?type=${workItem.type.id}`}
        className="text-sm underline underline-offset-4 opacity-70"
      >
        ← {workItem.type.label}
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">{workItem.title}</h1>
      <p className="text-sm opacity-70">
        {[
          workItem.status.label,
          workItem.customer?.label,
          workItem.location?.label,
          workItem.asset?.label,
          workItem.resource ? `→ ${workItem.resource.label}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {workItem.window ? (
        <p className="text-sm opacity-70">
          Scheduled {formatWindow(workItem.window, organization.timezone)}
        </p>
      ) : null}
      <CustomFieldValues definitions={definitions} custom={workItem.custom} />

      <section className="mt-8 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">Steps</h2>

        {checklist.length === 0 ? (
          <p className="mt-1 text-sm opacity-60">None yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {checklist.map((item) => (
              <li key={item.id}>
                {mayTick ? (
                  <ToggleChecklistItemForm
                    organizationId={organizationId}
                    workItemId={workItemId}
                    checklistItemId={item.id}
                    label={item.label}
                    done={item.doneAt !== null}
                  />
                ) : (
                  <span className={item.doneAt ? 'text-sm line-through opacity-60' : 'text-sm'}>
                    {item.doneAt ? '☑' : '☐'} {item.label}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {mayAdd ? (
          <AddChecklistItemForm
            organizationId={organizationId}
            workItemId={workItemId}
            position={nextPosition}
          />
        ) : null}
      </section>

      <section className="mt-8 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">Time worked</h2>
        {/* Not the same as the scheduled window above, and shown separately on purpose: the
            difference between planned and actual is the reporting value, and a screen that
            merged them would destroy it. */}

        {timeEntries.length === 0 ? (
          <p className="mt-1 text-sm opacity-60">None recorded.</p>
        ) : (
          <ul className="mt-2 divide-y divide-black/10 dark:divide-white/15">
            {timeEntries.map((entry) => (
              <li key={entry.id} className="py-2 text-sm">
                <div>{formatWindow(entry.worked, organization.timezone)}</div>
                <div className="opacity-70">
                  {[
                    entry.resourceId ? resourceName.get(entry.resourceId) : null,
                    entry.note,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </li>
            ))}
          </ul>
        )}

        {mayRecord ? (
          <RecordTimeForm
            organizationId={organizationId}
            workItemId={workItemId}
            resources={resources.map((resource) => ({ id: resource.id, label: resource.name }))}
          />
        ) : null}
      </section>

      <section className="mt-8 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">Cost</h2>

        {costs.length === 0 ? (
          <p className="mt-1 text-sm opacity-60">Nothing recorded.</p>
        ) : (
          <ul className="mt-2 divide-y divide-black/10 dark:divide-white/15">
            {costs.map((cost) => (
              <li key={cost.id} className="flex justify-between py-2 text-sm">
                <span>{cost.description}</span>
                {/* Each row renders in the currency it was recorded in, not the
                    organization's current one — a business that changed currency did not
                    change what last year's jobs cost (I8). */}
                <span className="opacity-70">
                  {formatMoney(cost.amountMinor, cost.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {mayRecord ? (
          <RecordCostForm
            organizationId={organizationId}
            workItemId={workItemId}
            currency={organization.currency}
          />
        ) : null}
      </section>
    </main>
  );
}
