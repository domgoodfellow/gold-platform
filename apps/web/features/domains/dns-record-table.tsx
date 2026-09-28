import { CopyField } from '@/components/controls/copy-field';
import { DataTable } from '@/components/display/table';
import type { DnsRecord } from '@/lib/adapters/domains';

/**
 * The records a person publishes at their DNS host, one row each, every value copyable exactly.
 * The provider does not ask for a particular TTL, so the column says to keep the host's default
 * rather than inventing a number.
 */
export function DnsRecordTable({ records }: { records: DnsRecord[] }) {
  return (
    <DataTable
      rows={records}
      rowKey={(record) => `${record.type}:${record.name}:${record.value}`}
      empty="There is nothing to publish."
      columns={[
        { key: 'type', header: 'Type', emphasis: 'primary', cell: (record) => <span className="font-mono text-xs">{record.type}</span> },
        { key: 'name', header: 'Name', cell: (record) => <CopyField value={record.name} label={`${record.type} record name`} size="small" mono /> },
        { key: 'value', header: 'Value', cell: (record) => <CopyField value={record.value} label={`${record.type} record value`} size="small" mono /> },
        { key: 'ttl', header: 'TTL', cell: () => <span className="text-muted">Your host&rsquo;s default</span> },
      ]}
    />
  );
}
