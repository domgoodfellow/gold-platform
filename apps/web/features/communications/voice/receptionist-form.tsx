'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/controls/button';
import { TextInput, Hint, ErrorText } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { configureReceptionist } from './receptionist-actions';

export type ReceptionistConfig={revision:number;deployment_ref:string;enabled:boolean;max_session_seconds:number;monthly_budget_seconds:number};
export function ReceptionistForm({organizationId,config}:{organizationId:string;config:ReceptionistConfig|null}) {
  const [draft,setDraft]=useState(config??{revision:0,deployment_ref:'',enabled:false,max_session_seconds:300,monthly_budget_seconds:0});
  const [error,setError]=useState<string|null>(null); const [saved,setSaved]=useState(false);const [pending,start]=useTransition();const router=useRouter();
  return <Section className="mt-6"><SectionHeading>AI receptionist</SectionHeading>
    <form className="mt-4 space-y-4" onSubmit={event=>{event.preventDefault();setSaved(false);start(async()=>{try{const result=await configureReceptionist(organizationId,{revision:draft.revision,deploymentRef:draft.deployment_ref,enabled:draft.enabled,maxSeconds:draft.max_session_seconds,budgetSeconds:draft.monthly_budget_seconds});setError(result.error);if(!result.error){setDraft({...draft,revision:draft.revision+1});setSaved(true);router.refresh();}}catch{setError('Could not save the receptionist. Try again.');}});}}>
      <label className="block text-sm">Published deployment reference<TextInput required maxLength={200} value={draft.deployment_ref} onChange={event=>setDraft({...draft,deployment_ref:event.target.value})}/></label>
      <label className="block text-sm">Maximum seconds per session<TextInput required type="number" min={30} max={3600} value={draft.max_session_seconds} onChange={event=>setDraft({...draft,max_session_seconds:Number(event.target.value)})}/></label>
      <label className="block text-sm">Monthly voice budget in seconds<TextInput required type="number" min={0} max={10000000} value={draft.monthly_budget_seconds} onChange={event=>setDraft({...draft,monthly_budget_seconds:Number(event.target.value)})}/></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={event=>setDraft({...draft,enabled:event.target.checked})}/>Enable receptionist</label>
      <Hint>Calls require Reception and Assistant access, an enabled route and enough budget. Zero budget blocks new sessions. Sessions reserve their maximum duration until the provider reports usage. Human transfer uses only the route’s configured member fallback.</Hint><ErrorText role="alert">{error}</ErrorText>{saved?<p role="status">Receptionist configuration saved.</p>:null}<Button type="submit" disabled={pending}>{pending?'Saving…':'Save receptionist'}</Button>
    </form></Section>;
}
