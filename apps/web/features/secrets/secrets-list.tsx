import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { Hint } from '@/components/controls/inputs';
import { secretUse, type SecretReference } from '@/lib/domain/secrets/secret-references';
import { SecretDeleteForm, SecretStatusForm } from './secret-row-actions';
import { SecretSheet } from './secret-sheet';

const date = (iso: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso));

/**
 * What this business has given GildOps to use. A row is a name, what it is for and what has
 * *happened* to it — never a value, and never a health the platform has not measured: a date under
 * "Last used" means a consumer has asked for it, and "Not used yet" means none has.
 */
export function SecretsList({ organizationId, references }: { organizationId: string; references: SecretReference[] }) {
  return (
    <div className="mt-5">
      <Hint className="mb-4">
        Private values GildOps may use on this business’s behalf. A stored value is never shown again, so to change one,
        replace it. Outside accounts you have signed in to are under Connections.
      </Hint>
      <DataTable
        rows={references}
        rowKey={(reference) => reference.id}
        empty="Nothing is stored yet. Add a credential when something GildOps builds or runs for this business needs one."
        columns={[
          {
            key: 'name',
            header: 'Name',
            emphasis: 'primary',
            cell: (reference) => (
              <span className="flex flex-col">
                <span className="font-medium">{reference.label}</span>
                <span className="font-mono text-xs text-muted">{reference.key}</span>
              </span>
            ),
          },
          { key: 'purpose', header: 'Purpose', cell: (reference) => reference.purpose || '—' },
          {
            key: 'status',
            header: 'Status',
            cell: (reference) => (
              <Badge tone={reference.status === 'active' ? 'success' : 'neutral'}>
                {reference.status === 'active' ? 'Stored' : 'Disabled'}
              </Badge>
            ),
          },
          {
            key: 'changed',
            header: 'Last changed',
            cell: (reference) => date(reference.rotatedAt ?? reference.createdAt),
          },
          {
            key: 'used',
            header: 'Last used',
            cell: (reference) => {
              const use = secretUse(reference);
              if (use === 'used' && reference.lastResolvedAt) return date(reference.lastResolvedAt);
              return <span className="text-muted">{use === 'disabled' ? '—' : 'Not used yet'}</span>;
            },
          },
        ]}
        actions={(reference) => (
          <div className="flex flex-wrap items-start gap-2">
            <SecretSheet mode="replace" organizationId={organizationId} reference={reference} />
            <SecretStatusForm organizationId={organizationId} reference={reference} />
            <SecretDeleteForm organizationId={organizationId} reference={reference} />
          </div>
        )}
      />
    </div>
  );
}
