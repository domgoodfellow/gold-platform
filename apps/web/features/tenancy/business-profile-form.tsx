'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/controls/button';
import { TextInput, ErrorText, Hint } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { BUSINESS_NOUNS, type BusinessProfile, type BusinessEntity } from '@/lib/domain/tenancy/business-profile';
import { saveBusinessProfileAction } from './business-profile-actions';

export function BusinessProfileForm({organizationId,profile,destinations}:{organizationId:string;profile:BusinessProfile|null;destinations:{key:string;label:string;workspace:string}[]}) {
  const [draft,setDraft]=useState<BusinessProfile>(profile??{revision:0,nouns:{},navigation:[],labels:{}});
  const [error,setError]=useState<string|null>(null); const [saved,setSaved]=useState(false); const [pending,start]=useTransition(); const router=useRouter();
  const order=[...draft.navigation.filter(key=>destinations.some(item=>item.key===key)),...destinations.filter(item=>!draft.navigation.includes(item.key)).map(item=>item.key)];
  const workspaceOf=new Map(destinations.map(item=>[item.key,item.workspace]));
  const groups=[...new Set(order.map(key=>workspaceOf.get(key)??'Organization'))];
  // Order matters only among one workspace's pages, so a move swaps with its neighbour in the same workspace.
  function move(key:string,direction:number) {const peers=order.filter(candidate=>workspaceOf.get(candidate)===workspaceOf.get(key));const target=peers.indexOf(key)+direction;if(target<0||target>=peers.length)return;const next=[...order];const from=next.indexOf(key);const to=next.indexOf(peers[target]);[next[from],next[to]]=[next[to],next[from]];setDraft({...draft,navigation:next});}
  return <Section className="mt-6"><SectionHeading>Business words and navigation</SectionHeading>
    {!profile?<Hint className="mt-2">Choose the words and destinations your business uses. These choices do not change access or existing record names.</Hint>:null}
    <form className="mt-4 space-y-5" onSubmit={event=>{event.preventDefault();setSaved(false);start(async()=>{const result=await saveBusinessProfileAction(organizationId,draft);setError(result.error);if(!result.error){setDraft({...draft,revision:draft.revision+1});setSaved(true);router.refresh();}});}}>
      <div className="grid gap-4 sm:grid-cols-2">{Object.entries(BUSINESS_NOUNS).map(([key,defaults])=>{const entity=key as BusinessEntity;const words=draft.nouns[entity]??defaults;return <fieldset key={key} className="space-y-2"><legend className="font-medium">{defaults.singular}</legend>{(['singular','plural'] as const).map(form=><label key={form} className="block text-sm">{form==='singular'?'One record':'Several records'}<TextInput required maxLength={80} aria-label={`${defaults.singular} ${form}`} value={words[form]} onChange={event=>setDraft({...draft,nouns:{...draft.nouns,[entity]:{...words,[form]:event.target.value}}})}/></label>)}</fieldset>;})}</div>
      <fieldset className="space-y-4"><legend className="mb-2 font-medium">Workspace page labels and order</legend><Hint>Pages stay inside their workspace. These choices change their labels and order.</Hint>
        {groups.map(group=>{const members=order.filter(key=>(workspaceOf.get(key)??'Organization')===group);return <fieldset key={group} className="space-y-2"><legend className="text-sm font-medium">{group}</legend><ol className="space-y-2">{members.map((key,index)=>{const item=destinations.find(item=>item.key===key)!;return <li key={key} className="flex flex-wrap items-center gap-2"><label className="flex min-w-0 flex-1 flex-col text-sm">{item.label}<TextInput maxLength={80} aria-label={`${item.label} navigation label`} value={draft.labels[key]??item.label} onChange={event=>setDraft({...draft,labels:{...draft.labels,[key]:event.target.value}})}/></label><Button type="button" tone="secondary" aria-label={`Move ${item.label} up`} disabled={index===0||pending} onClick={()=>move(key,-1)}>↑</Button><Button type="button" tone="secondary" aria-label={`Move ${item.label} down`} disabled={index===members.length-1||pending} onClick={()=>move(key,1)}>↓</Button></li>;})}</ol></fieldset>;})}
      </fieldset>
      <ErrorText role="alert">{error}</ErrorText>{saved?<p role="status">Business profile saved.</p>:null}<Button type="submit" disabled={pending}>{pending?'Saving…':'Save business words and navigation'}</Button>
    </form>
  </Section>;
}
