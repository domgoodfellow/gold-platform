'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/controls/button';
import { TextInput, ErrorText, Hint } from '@/components/controls/inputs';
import { Card } from '@/components/surfaces/card';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { useUnsavedChanges } from '@/components/controls/use-unsaved-changes';
import { BUSINESS_NOUNS, type BusinessProfile, type BusinessEntity } from '@/lib/domain/tenancy/business-profile';
import { saveBusinessProfileAction } from './business-profile-actions';

/**
 * The versioned business profile's words and workspace page labels, saved together. Settings →
 * Words & navigation renders it as the page's content; Setup embeds it under its own heading.
 */
export function BusinessProfileForm({organizationId,profile,destinations,embedded=false}:{organizationId:string;profile:BusinessProfile|null;destinations:{key:string;label:string;workspace:string}[];embedded?:boolean}) {
  const [draft,setDraftState]=useState<BusinessProfile>(profile??{revision:0,nouns:{},navigation:[],labels:{}});
  const [dirty,setDirty]=useState(false);
  const [error,setError]=useState<string|null>(null); const [saved,setSaved]=useState(false); const [pending,start]=useTransition(); const router=useRouter();
  useUnsavedChanges(dirty);
  const setDraft=(next:BusinessProfile)=>{setDraftState(next);setDirty(true);setSaved(false);};
  const order=[...draft.navigation.filter(key=>destinations.some(item=>item.key===key)),...destinations.filter(item=>!draft.navigation.includes(item.key)).map(item=>item.key)];
  const workspaceOf=new Map(destinations.map(item=>[item.key,item.workspace]));
  const groups=[...new Set(order.map(key=>workspaceOf.get(key)??'Organization'))];
  // Order matters only among one workspace's pages, so a move swaps with its neighbour in the same workspace.
  function move(key:string,direction:number) {const peers=order.filter(candidate=>workspaceOf.get(candidate)===workspaceOf.get(key));const target=peers.indexOf(key)+direction;if(target<0||target>=peers.length)return;const next=[...order];const from=next.indexOf(key);const to=next.indexOf(peers[target]);[next[from],next[to]]=[next[to],next[from]];setDraft({...draft,navigation:next});}
  const form=<form className="flex flex-col gap-6" onSubmit={event=>{event.preventDefault();setSaved(false);start(async()=>{const result=await saveBusinessProfileAction(organizationId,draft);setError(result.error);if(!result.error){setDraftState({...draft,revision:draft.revision+1});setDirty(false);setSaved(true);router.refresh();}});}}>
    <Hint>{profile?'These choices change labels only. Access, addresses and existing record names stay the same.':'Choose the words and page labels your business uses. These choices change labels only. Access, addresses and existing record names stay the same.'}</Hint>
    <Card as="section" aria-labelledby="terminology-nouns-heading">
      <div className="flex flex-col gap-4">
        <SectionHeading id="terminology-nouns-heading">Record names</SectionHeading>
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">{Object.entries(BUSINESS_NOUNS).map(([key,defaults])=>{const entity=key as BusinessEntity;const words=draft.nouns[entity]??defaults;return <fieldset key={key} className="flex min-w-0 flex-col gap-2"><legend className="mb-1 text-sm font-medium">{defaults.singular}</legend><div className="grid grid-cols-2 gap-2">{(['singular','plural'] as const).map(form=><label key={form} className="flex min-w-0 flex-col gap-1 text-xs text-muted">{form==='singular'?'One':'Several'}<TextInput required maxLength={80} aria-label={`${defaults.singular} ${form}`} value={words[form]} onChange={event=>setDraft({...draft,nouns:{...draft.nouns,[entity]:{...words,[form]:event.target.value}}})}/></label>)}</div></fieldset>;})}</div>
      </div>
    </Card>
    <Card as="section" aria-labelledby="terminology-pages-heading">
      <div className="flex flex-col gap-4">
        <div><SectionHeading id="terminology-pages-heading">Workspace pages</SectionHeading></div>
        {groups.map(group=>{const members=order.filter(key=>(workspaceOf.get(key)??'Organization')===group);return <fieldset key={group} className="flex flex-col gap-2"><legend className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">{group}</legend><ol className="flex flex-col gap-2">{members.map((key,index)=>{const item=destinations.find(item=>item.key===key)!;return <li key={key} className="flex items-end gap-2"><label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">{item.label}<TextInput maxLength={80} aria-label={`${item.label} navigation label`} value={draft.labels[key]??item.label} onChange={event=>setDraft({...draft,labels:{...draft.labels,[key]:event.target.value}})}/></label><Button type="button" tone="secondary" aria-label={`Move ${item.label} up`} disabled={index===0||pending} onClick={()=>move(key,-1)}>↑</Button><Button type="button" tone="secondary" aria-label={`Move ${item.label} down`} disabled={index===members.length-1||pending} onClick={()=>move(key,1)}>↓</Button></li>;})}</ol></fieldset>;})}
      </div>
    </Card>
    <div className="flex flex-col items-start gap-3">
      <Button type="submit" disabled={pending}>{pending?'Saving…':'Save business words and navigation'}</Button>
      <ErrorText role="alert">{error}</ErrorText>{saved&&!dirty?<p role="status" className="text-sm text-muted">Business profile saved.</p>:null}
    </div>
  </form>;
  return embedded?<Section className="mt-6"><SectionHeading>Business words and navigation</SectionHeading><div className="mt-4">{form}</div></Section>:form;
}
