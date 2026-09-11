import { Badge } from '@/components/display/data';
import { Hint } from '@/components/controls/inputs';
import { DataTable } from '@/components/display/table';
import { DividedList, EmptyState, PageHeading, Section, SectionHeading } from '@/components/containers/section';
import { AppPage } from '@/components/containers/app-page';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { isPlatformStaff, listFailures, listTenants } from '@/lib/domain/platform/tenants';
import { ProvisionForm } from './provision-form';

export const dynamic = 'force-dynamic';

/**
 * The first screen in this application built for us rather than for a tenant.
 *
 * **`(platform)` is a route group and therefore a layout boundary, never a security one** —
 * the same thing `(auth)` and `(public)` are. What keeps a member out of this page is that
 * `platform_tenants` runs `security_invoker`, so a member selecting from it sees their own
 * organizations and a stranger sees nothing. The redirect below is courtesy, exactly as
 * `proxy.ts` is: delete it and this page shows a non-staff visitor an empty list, which is
 * ugly and still correct.
 *
 * **It names no area and has no sidebar**, because `lib/navigation.ts` holds the nouns of *a
 * business* and this is not one. A platform noun list would be a second navigation with one
 * entry; when this console has three screens it can have a shell, and not before.
 */
export default async function PlatformPage() {
  const db = await getDb();

  try {
    await requireActor(db);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'auth.required') {
      redirect('/login');
    }
    throw error;
  }

  if (!(await isPlatformStaff(db))) {
    redirect('/organizations');
  }

  redirect('/platform/organizations');

  const [{ tenants, total }, failures] = await Promise.all([
    listTenants(db),
    listFailures(db),
  ]);

  return (
    <AppPage width="full">
      <div className="flex items-baseline justify-between">
        <PageHeading>Overview</PageHeading>
      </div>

      <Hint className="mt-2">
        {total === 1 ? '1 business' : `${total} businesses`} on GOLD.
        {/* **A partial list says so.** The console read an unbounded select until this change,
            which PostgREST answers with its first thousand rows and no indication that it did —
            so the oldest tenants simply were not there, which is the half somebody chasing a
            lapsed business is looking for. Application state in the platform's own voice, and
            the remedy is a filter or a next page, neither of which has a caller yet. */}
        {total > tenants.length
          ? ` Showing the most recent ${tenants.length}.`
          : ''}
      </Hint>

      {/*
        The operator door (D29). It sits above the list because provisioning is the thing this
        console *does* — the list is what it shows. A business arrives here and appears in the
        table below on the next render, which is `newest first` earning its ordering.
      */}
      <ProvisionForm />

      <div className="mt-6">
        <DataTable
          rows={tenants}
          rowKey={(tenant) => tenant.id}
          empty="No business has been provisioned yet."
          columns={[
            {
              key: 'name',
              header: 'Business',
              emphasis: 'primary',
              cell: (tenant) => (
                <>
                  <Link href={`/platform/organizations/${tenant.id}`} className="underline underline-offset-4">
                    {tenant.name}
                  </Link>
                  {tenant.slug ? (
                    <span className="block text-xs font-normal text-subtle">
                      /book/{tenant.slug}
                    </span>
                  ) : null}
                </>
              ),
            },
            {
              key: 'arrived',
              header: 'Arrived',
              // Rendered in the tenant's own zone, not ours. A console showing every business
              // in one timezone would be the platform deciding what "Tuesday" means for
              // somebody in Tokyo (I9).
              cell: (tenant) => (
                <span className="tabular-nums">
                  {new Date(tenant.createdAt).toLocaleDateString('en-CA', {
                    timeZone: tenant.timezone,
                  })}
                </span>
              ),
            },
            {
              key: 'trades',
              header: 'Trades in',
              cell: (tenant) => (
                <>
                  {/* Empty when the business has not said — signing up no longer asks, and a
                      console inventing a currency for a tenant would be the same platform
                      assumption one level removed. */}
                  {tenant.currency ? tenant.currency : <span className="text-subtle">—</span>}
                  <span className="block text-xs text-subtle">{tenant.timezone}</span>
                </>
              ),
            },
            {
              key: 'modules',
              header: 'Switched on',
              emphasis: 'secondary',
              cell: (tenant) =>
                tenant.moduleKeys.length === 0 ? (
                  <span className="text-subtle">Kernel only</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {tenant.moduleKeys.map((key) => (
                      <Badge key={key}>{key}</Badge>
                    ))}
                  </div>
                ),
            },
            {
              key: 'activity',
              header: 'Last activity',
              cell: (tenant) =>
                tenant.lastActivityAt ? (
                  <span className="tabular-nums">
                    {new Date(tenant.lastActivityAt).toLocaleString('en-CA', {
                      timeZone: tenant.timezone,
                    })}
                  </span>
                ) : (
                  <span className="text-subtle">Nothing yet</span>
                ),
            },
          ]}
        />
      </div>

      {/*
        **The fourth question, and the reason M5 could not answer it.** That milestone said
        plainly that nothing in this schema recorded a failure — a `DomainError` was raised,
        rendered to whoever caused it, and dropped — and that building a failed-thing table then
        would have been a table with no writer. M6's automation is the first thing this platform
        does that fails with nobody watching, and this reads what it wrote.

        Names the business rather than linking to it: staff hold no membership anywhere, so
        there is nothing to open. What is here is enough to pick up the phone.
      */}
      <Section className="mt-10">
        <SectionHeading>What is failing</SectionHeading>

        {failures.length === 0 ? (
          <EmptyState className="mt-2">
            Nothing has failed. This counts automations that could not run and messages a
            provider would not take — the two things that happen with nobody watching.
          </EmptyState>
        ) : (
          <DividedList className="mt-2 text-sm">
            {failures.map((failure, index) => {
              const tenant = tenants.find((entry) => entry.id === failure.organizationId);
              return (
                <li
                  key={`${failure.occurredAt}-${index}`}
                  className="flex flex-wrap items-baseline gap-x-3 py-2"
                >
                  <span className="tabular-nums text-subtle">
                    {new Date(failure.occurredAt).toLocaleString('en-CA')}
                  </span>
                  <span className="font-medium">{tenant?.name ?? 'a business'}</span>
                  <span className="text-subtle">{failure.kind}</span>
                  <span>{failure.subject}</span>
                  {/* The database's or the provider's own words, kept verbatim. An
                      interpretation here would be the console guessing at somebody else's
                      error. */}
                  <span className="text-danger">{failure.detail}</span>
                </li>
              );
            })}
          </DividedList>
        )}
      </Section>
    </AppPage>
  );
}
