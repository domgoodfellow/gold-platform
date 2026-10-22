import { ButtonLink } from '@/components/controls/button';
import type { CrmTask } from '@/lib/domain/tasks/tasks';
import { FollowUpSheet, type FollowUpOptions } from './follow-up-sheet';
import { FollowUpList } from './follow-up-list';
export function RelatedFollowUps({ open,recent,customer,opportunity,now,...options }:FollowUpOptions & {open:CrmTask[];recent:CrmTask[];now:string;customer:{id:string;name:string};opportunity?:{id:string;title:string}}) {
  const overdue=open.filter(f=>Date.parse(f.dueAt)<Date.parse(now)); const upcoming=open.filter(f=>Date.parse(f.dueAt)>=Date.parse(now));
  const filter=new URLSearchParams({customer:customer.id}); if(opportunity)filter.set('opportunity',opportunity.id);
  return <section className="space-y-5" aria-label="Follow-ups"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Follow-ups</h2><div className="flex gap-2"><ButtonLink tone="text" href={`/organizations/${options.organizationId}/crm/tasks?${filter}`}>View all</ButtonLink>{options.mayManage?<FollowUpSheet {...options} customer={customer} opportunity={opportunity}/>:null}</div></div>
    {open[0]?<div className="rounded-lg border-l-4 border-foreground bg-surface p-4"><p className="mb-1 text-xs text-muted">Next action</p><FollowUpList {...options} items={[open[0]]} compact/></div>:<p className="text-sm text-muted">No next follow-up scheduled.</p>}
    <div><h3 className="text-sm font-medium">Overdue</h3><FollowUpList {...options} items={overdue}/></div><div><h3 className="text-sm font-medium">Upcoming</h3><FollowUpList {...options} items={upcoming}/></div><div><h3 className="text-sm font-medium">Recently completed</h3><FollowUpList {...options} items={recent}/></div>
  </section>;
}
