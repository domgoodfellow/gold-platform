'use client';
import { useState } from 'react';
import { ButtonLink } from '@/components/controls/button';
import { FollowUpList } from '@/features/crm/follow-ups/follow-up-list';
import type { FollowUpOptions } from '@/features/crm/follow-ups/follow-up-sheet';
import { OpportunityTable } from '@/features/crm/opportunities/opportunity-table';
import type { Opportunity } from '@/lib/domain/opportunities/opportunities';
import type { FollowUp } from '@/lib/domain/follow-ups/follow-ups';
import type { CrmSummary } from '@/lib/application/crm/dashboard';
export function NeedsAttention({summary,overdue,today,noNext,unassigned,options,followUpsEnabled}:{summary:CrmSummary;overdue:FollowUp[];today:FollowUp[];noNext:Opportunity[];unassigned:Opportunity[];options:FollowUpOptions;followUpsEnabled:boolean}) {
  const [tab,setTab]=useState(followUpsEnabled?'overdue':'unassigned'); const base=`/organizations/${options.organizationId}`;
  const tabs=[...(followUpsEnabled?[{key:'overdue',label:'Overdue',count:summary.overdue,href:`${base}/follow-ups?status=open&due=overdue`},{key:'today',label:'Due today',count:summary.today,href:`${base}/follow-ups?status=open&due=today`},{key:'noNext',label:'No next follow-up',count:summary.noNext,href:`${base}/opportunities?kind=open&next=none`}]:[]),{key:'unassigned',label:'Unassigned opportunities',count:summary.unassigned,href:`${base}/opportunities?kind=open&owner=unassigned`}];
  return <><div className="flex flex-wrap gap-1 border-b border-border pb-2" aria-label="Attention categories">{tabs.map(t=><button key={t.key} type="button" aria-pressed={tab===t.key} onClick={()=>setTab(t.key)} className={`rounded-md px-3 py-2 text-xs font-medium ${tab===t.key?'bg-foreground text-background':'text-muted hover:bg-surface'}`}>{t.label} <span className="ml-1 tabular-nums">{t.count}</span></button>)}</div><div className="min-w-0 pt-1">{tab==='overdue'||tab==='today'?<FollowUpList {...options} items={tab==='overdue'?overdue:today}/>:<OpportunityTable organizationId={options.organizationId} opportunities={tab==='noNext'?noNext:unassigned} timezone={options.timezone} followUpOptions={followUpsEnabled?options:undefined}/>}</div><div className="mt-2 text-right"><ButtonLink tone="text" href={tabs.find(t=>t.key===tab)?.href??`${base}/opportunities`}>View all</ButtonLink></div></>;
}
