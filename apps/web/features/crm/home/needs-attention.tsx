'use client';
import { useState } from 'react';
import { tabListStyles, tabTriggerStyles } from '@gold/ui/components/tab-styles';
import { ButtonLink } from '@/components/controls/button';
import { FollowUpList } from '@/features/crm/follow-ups/follow-up-list';
import type { FollowUpOptions } from '@/features/crm/follow-ups/follow-up-sheet';
import Link from 'next/link';
import type { Opportunity } from '@/lib/domain/opportunities/opportunities';
import type { CrmTask } from '@/lib/domain/tasks/tasks';

export type AttentionCounts = { overdue: number; today: number; noNext: number; unassigned: number };
/**
 * Real exceptions only. Overdue is open and past due; Today is open and due later today, so a task is
 * never in both. Opportunity categories exist only when the sales section does. The parent shows a
 * compact all-clear line instead of this panel when every count is zero.
 */
export function NeedsAttention({counts,overdue,today,noNext,unassigned,options,followUpsEnabled,salesEnabled}:{counts:AttentionCounts;overdue:CrmTask[];today:CrmTask[];noNext:Opportunity[];unassigned:Opportunity[];options:FollowUpOptions;followUpsEnabled:boolean;salesEnabled:boolean}) {
  const base=`/organizations/${options.organizationId}`;
  const tabs=[
    ...(followUpsEnabled?[{key:'overdue',label:'Overdue',count:counts.overdue,href:`${base}/crm/tasks?status=open&due=overdue`},{key:'today',label:'Due today',count:counts.today,href:`${base}/crm/tasks?status=open&due=today`}]:[]),
    ...(followUpsEnabled&&salesEnabled?[{key:'noNext',label:'No next follow-up',count:counts.noNext,href:`${base}/crm/opportunities?kind=open&next=none`}]:[]),
    ...(salesEnabled?[{key:'unassigned',label:'Unassigned',count:counts.unassigned,href:`${base}/crm/opportunities?kind=open&owner=unassigned`}]:[]),
  ].filter(t=>t.count>0);
  const [chosen,setTab]=useState<string|null>(null); const tab=tabs.find(t=>t.key===chosen)??tabs[0];
  if(!tab) return null;
  return <>{tabs.length>1?<div data-slot="tabs-list" data-variant="segmented" className={tabListStyles()} role="group" aria-label="Attention categories">{tabs.map(t=><button key={t.key} type="button" aria-pressed={tab.key===t.key} onClick={()=>setTab(t.key)} data-slot="tabs-trigger" className={tabTriggerStyles}>{t.label} <span className="ml-1 tabular-nums">{t.count}</span></button>)}</div>:<p className="text-sm font-medium">{tab.label} <span className="tabular-nums text-muted">{tab.count}</span></p>}
    <div className="min-w-0 pt-1">{tab.key==='overdue'||tab.key==='today'?<FollowUpList {...options} items={tab.key==='overdue'?overdue:today} compact/>:<ul className="divide-y divide-border text-sm">{(tab.key==='noNext'?noNext:unassigned).map(o=><li key={o.id} className="py-2"><Link className="break-words font-medium hover:underline" href={`${base}/crm/opportunities/${o.id}`}>{o.title}</Link><span className="block text-xs text-muted">{o.customerName}{o.stage?` · ${o.stage.name}`:' · Unstaged'}</span></li>)}</ul>}</div>
    <div className="mt-2 text-right"><ButtonLink tone="text" href={tab.href}>View all</ButtonLink></div></>;
}
