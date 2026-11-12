import { notFound } from 'next/navigation';
import { ButtonLink } from '@/components/controls/button';
import { DataTable } from '@/components/display/table';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-frame';
import { listAccessChanges } from '@/lib/domain/tenancy/access-history';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Access history: who changed a role, a member's role or an invitation, and when. Read-only, from
 * the business's own event log. Offered with the rest of Access, to a member who manages roles.
 */
export default async function AccessHistoryPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/settings/access/history'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('role.manage')) notFound();
  const query = await searchParams;
  const rawPage = typeof query.page === 'string' ? Number(query.page) : 1;
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = 50;
  const changes = await listAccessChanges(db, { organizationId, offset: (page - 1) * pageSize, limit: pageSize + 1 });
  const href = (value: number) => `/organizations/${organizationId}/settings/access/history?page=${value}`;

  return (
    <SettingsPageFrame width="fluid">
      <SettingsPageHeader title="Access history" />
      <div className="mt-4">
        <DataTable
          rows={changes.slice(0, pageSize)}
          rowKey={(change) => change.id}
          empty="No access changes yet."
          columns={[
            { key: 'when', header: 'When', cell: (change) => new Date(change.occurredAt).toLocaleString('en-CA', { timeZone: organization.timezone || undefined, dateStyle: 'medium', timeStyle: 'short' }) },
            { key: 'who', header: 'Changed by', cell: (change) => change.actor },
            { key: 'what', header: 'Change', emphasis: 'primary', cell: (change) => <span className="whitespace-normal break-words">{change.summary}</span> },
          ]}
        />
        {page > 1 || changes.length > pageSize ? (
          <nav aria-label="Access history pages" className="mt-4 flex flex-wrap items-center gap-3">
            {page > 1 ? <ButtonLink href={href(page - 1)} tone="secondary" size="small">Newer changes</ButtonLink> : null}
            {changes.length > pageSize ? <ButtonLink href={href(page + 1)} tone="secondary" size="small">Older changes</ButtonLink> : null}
          </nav>
        ) : null}
      </div>
    </SettingsPageFrame>
  );
}
