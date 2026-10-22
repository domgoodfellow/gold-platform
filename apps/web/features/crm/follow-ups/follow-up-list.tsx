'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { FormError } from '@/components/controls/form';
import { changeFollowUpStatusAction } from '@/app/organizations/[organizationId]/crm/tasks/actions';
import type { CrmTask } from '@/lib/domain/tasks/tasks';
import { FollowUpSheet, type FollowUpOptions } from './follow-up-sheet';
export function FollowUpStatusAction({ organizationId,item,status }: {organizationId:string;item:CrmTask;status:'completed'|'cancelled'}) {
  const [state,action,pending]=useActionState(changeFollowUpStatusAction,{error:null,savedId:null});
  return <form action={action}><input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="id" value={item.id}/><input type="hidden" name="status" value={status}/><Button type="submit" tone="text" size="small" disabled={pending} aria-label={`${status==='completed'?'Complete':'Cancel'} ${item.title}`}>{pending?'Saving…':status==='completed'?'Complete':'Cancel'}</Button><FormError>{state.error}</FormError></form>;
}
export function followUpTime(dueAt:string,timezone:string) {return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(dueAt));}
export function FollowUpList({items,compact=false,...options}:FollowUpOptions & {items:CrmTask[];compact?:boolean}) {
  if(!items.length)return <p className="py-5 text-sm text-muted">No follow-ups in this view.</p>;
  const base=`/organizations/${options.organizationId}`;
  if(compact)return <ul className="divide-y divide-border">{items.map(item=><li key={item.id} className="flex items-start justify-between gap-3 py-3"><div className="min-w-0 space-y-1"><p className="text-xs capitalize text-muted">{item.kind} · {followUpTime(item.dueAt,options.timezone)}</p><FollowUpSheet {...options} item={item}>{item.title}</FollowUpSheet><p className="text-xs text-muted">{item.customerName}{item.opportunityTitle?` · ${item.opportunityTitle}`:''}</p><p className="text-xs text-muted">{item.ownerName ?? 'Unassigned'}</p></div>{options.mayManage && item.status==='open'?<FollowUpStatusAction organizationId={options.organizationId} item={item} status="completed"/>:null}</li>)}</ul>;
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Follow-ups</caption><thead className="border-b border-border text-xs text-muted"><tr>{['Type','Follow-up','Customer','Opportunity','Due','Owner','Status','Actions'].map(label=><th key={label} className="whitespace-nowrap px-3 py-3 font-medium" scope="col">{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{items.map(item=><tr key={item.id}>
    <td className="px-3 py-3 capitalize text-muted">{item.kind}</td><td className="min-w-40 px-3 py-3"><FollowUpSheet {...options} item={item}>{item.title}</FollowUpSheet></td>
    <td className="px-3 py-3"><Link href={`${base}/crm/contacts/${item.customerId}`}>{item.customerName}</Link></td><td className="px-3 py-3">{item.opportunityId?<Link href={`${base}/crm/opportunities/${item.opportunityId}`}>{item.opportunityTitle}</Link>:'—'}</td>
    <td className="whitespace-nowrap px-3 py-3"><time dateTime={item.dueAt}>{followUpTime(item.dueAt,options.timezone)}</time></td><td className="px-3 py-3">{item.ownerName ?? 'Unassigned'}</td><td className="px-3 py-3 capitalize">{item.status}</td>
    <td className="px-3 py-3">{options.mayManage && item.status==='open'?<div className="flex"><FollowUpStatusAction organizationId={options.organizationId} item={item} status="completed"/><FollowUpSheet {...options} item={item}>Reschedule</FollowUpSheet><FollowUpStatusAction organizationId={options.organizationId} item={item} status="cancelled"/></div>:null}</td>
  </tr>)}</tbody></table></div>;
}
