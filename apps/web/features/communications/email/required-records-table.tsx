import { CopyField } from '@/components/controls/copy-field';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import type { RequiredDnsRecord } from '@/lib/domain/email/sending-domains';

/**
 * The records the provider wants published, one row each, every value copyable exactly.
 *
 * **What the provider said, in the provider's own order and words.** Nothing here assumes a
 * particular set — no "there is always an SPF record", no fixed count — because what is required
 * is the provider's answer and changes with what the domain is for. *Purpose* is the provider's
 * own short word for each, which is what lets a person tell three near-identical TXT rows apart
 * when they go looking at their DNS host.
 *
 * TTL has a column because a person filling in a form at their DNS host is asked for one, and the
 * provider does not ask for a particular value — so it says to keep the host's default rather
 * than inventing a number.
 */
export function RequiredRecordsTable({ records }: { records: RequiredDnsRecord[] }) {
  return (
    <DataTable
      rows={records}
      rowKey={(record) => `${record.type}:${record.name}:${record.value}`}
      empty="No records are needed yet."
      columns={[
        {
          key: 'purpose',
          header: 'Purpose',
          emphasis: 'primary',
          cell: (record) => (
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{record.type}</span>
              {record.purpose ? <span>{record.purpose}</span> : null}
              <Badge tone={record.status === 'verified' ? 'success' : 'neutral'}>
                {record.status === 'verified' ? 'Verified' : record.status === 'failed' ? 'Not found' : 'Waiting'}
              </Badge>
            </span>
          ),
        },
        {
          key: 'name',
          header: 'Name',
          cell: (record) => <CopyField value={record.name} label={`${record.type} record name`} size="small" mono />,
        },
        {
          key: 'value',
          header: 'Value',
          cell: (record) => <CopyField value={record.value} label={`${record.type} record value`} size="small" mono />,
        },
        {
          key: 'priority',
          header: 'Priority',
          visibility: 'card-only',
          cell: (record) => (record.priority === undefined ? <span className="text-muted">—</span> : <span className="font-mono text-xs">{record.priority}</span>),
        },
        { key: 'ttl', header: 'TTL', visibility: 'card-only', cell: () => <span className="text-muted">Your host&rsquo;s default</span> },
      ]}
    />
  );
}
