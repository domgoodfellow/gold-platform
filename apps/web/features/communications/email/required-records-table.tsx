import { CopyField } from '@/components/controls/copy-field';
import { Badge } from '@/components/display/data';
import type { RequiredDnsRecord } from '@/lib/domain/email/sending-domains';

const STATUS: Record<RequiredDnsRecord['status'], { label: string; tone: 'success' | 'danger' | 'neutral' }> = {
  verified: { label: 'Verified', tone: 'success' },
  failed: { label: 'Not found', tone: 'danger' },
  pending: { label: 'Pending', tone: 'neutral' },
};

/**
 * The records the provider wants published, one block each, every value copyable exactly.
 *
 * **What the provider said, in the provider's own order and words.** Nothing here assumes a
 * particular set — no "there is always an SPF record", no fixed count — because what is required
 * is the provider's answer. *Purpose* is the provider's own short word for each, which is what
 * lets a person tell near-identical TXT records apart at their DNS host. Each status is the
 * provider's answer for that record: Verified, Not found, or Pending until it has looked.
 *
 * A record's host and value stack under their labels rather than sharing a row with the others,
 * so a 400-character DKIM key never pushes its copy button off the screen; the value sits in a
 * read-only field, so it is copied whole.
 */
export function RequiredRecordsTable({ records }: { records: RequiredDnsRecord[] }) {
  if (records.length === 0) return <p className="text-sm text-muted">No records are needed yet.</p>;
  return (
    <ul aria-label="DNS records" className="@container flex flex-col divide-y divide-border border-y border-border">
      {records.map((record) => {
        const status = STATUS[record.status];
        return (
          <li key={`${record.type}:${record.name}:${record.value}`} className="flex flex-col gap-2 py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs font-medium">{record.type}</span>
              {record.purpose ? <span>{record.purpose}</span> : null}
              <Badge tone={status.tone}>{status.label}</Badge>
            </div>
            <dl className="grid gap-2 @min-[36rem]:grid-cols-[5rem_minmax(0,1fr)] @min-[36rem]:items-center">
              <dt className="text-xs text-muted">Host</dt>
              <dd className="min-w-0"><CopyField value={record.name} label={`${record.type} record host`} size="small" mono /></dd>
              <dt className="text-xs text-muted">Value</dt>
              <dd className="min-w-0"><CopyField value={record.value} label={`${record.type} record value`} size="small" mono /></dd>
              {record.priority !== undefined ? (
                <>
                  <dt className="text-xs text-muted">Priority</dt>
                  <dd className="font-mono text-xs">{record.priority}</dd>
                </>
              ) : null}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
