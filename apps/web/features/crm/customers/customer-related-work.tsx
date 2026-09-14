import Link from 'next/link';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import type { WorkItem } from '@/lib/domain/work-items/work-items';

export function CustomerRelatedWork({ organizationId, work }: { organizationId: string; work: WorkItem[] }) {
  return <DataTable rows={work} rowKey={(item) => item.id} empty="No work recorded for this customer." columns={[
    { key: 'work', header: 'Work', emphasis: 'primary', cell: (item) => <Link href={`/organizations/${organizationId}/work/${item.id}`} className="underline underline-offset-4">{item.title}</Link> },
    { key: 'type', header: 'Type', cell: (item) => item.type.label },
    { key: 'status', header: 'Status', cell: (item) => <Badge>{item.status.label}</Badge> },
    { key: 'schedule', header: 'Schedule', cell: (item) => item.window ? 'Scheduled' : <span className="text-subtle">Not scheduled</span> },
  ]} />;
}
