'use client';
import { useState } from 'react';
import { tabListStyles, tabTriggerStyles } from '@gold/ui/components/tab-styles';
import { ButtonLink } from '@/components/controls/button';
import { PanelState } from '@/components/operational/primitives';
import { FollowUpList } from '@/features/crm/follow-ups/follow-up-list';
import type { FollowUpOptions } from '@/features/crm/follow-ups/follow-up-sheet';
import { OpportunityTable } from '@/features/crm/opportunities/opportunity-table';
import type { Opportunity } from '@/lib/domain/opportunities/opportunities';
import type { CrmTask } from '@/lib/domain/tasks/tasks';
import type { CrmSummary } from '@/lib/application/crm/dashboard';
/** Exceptions only: what is late, what has no next step, what has nobody. The day's agenda is Today's. */
export function NeedsAttention({summary,overdue,noNext,unassigned,options,followUpsEnabled}:{summary:CrmSummary;overdue:CrmTask[];noNext:Opportunity[];unassigned:Opportunity[];options:FollowUpOptions;followUpsEnabled:boolean}) {
  const base=`/organizations/${options.organizationId}`;
  const tabs=[...(followUpsEnabled?[{key:'overdue',label:'Overdue',count:summary.overdue,href:`${base}/crm/tasks?status=open&due=overdue`},{key:'noNext',label:'No next follow-up',count:summary.noNext,href:`${base}/crm/opportunities?kind=open&next=none`}]:[]),{key:'unassigned',label:'Unassigned',count:summary.unassigned,href:`${base}/crm/opportunities?kind=open&owner=unassigned`}].filter(t=>t.count>0);
  const [chosen,setTab]=useState<string|null>(null); const tab=tabs.find(t=>t.key===chosen)??tabs[0];
  if(!tab) return <PanelState>Nothing needs attention.</PanelState>;
  return <>{tabs.length>1?<div data-slot="tabs-list" data-variant="segmented" className={tabListStyles()} role="group" aria-label="Attention categories">{tabs.map(t=><button key={t.key} type="button" aria-pressed={tab.key===t.key} onClick={()=>setTab(t.key)} data-slot="tabs-trigger" className={tabTriggerStyles}>{t.label} <span className="ml-1 tabular-nums">{t.count}</span></button>)}</div>:<p className="text-sm font-medium">{tab.label} <span className="tabular-nums text-muted">{tab.count}</span></p>}<div className="min-w-0 pt-1">{tab.key==='overdue'?<FollowUpList {...options} items={overdue} compact/>:<OpportunityTable organizationId={options.organizationId} opportunities={tab.key==='noNext'?noNext:unassigned} timezone={options.timezone} followUpOptions={followUpsEnabled?options:undefined}/>}</div><div className="mt-2 text-right"><ButtonLink tone="text" href={tab.href}>View all</ButtonLink></div></>;
}
