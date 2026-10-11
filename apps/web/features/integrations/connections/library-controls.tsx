'use client';
import { useActionState, useState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, TextInput } from '@/components/controls/inputs';
import { connectLibraryKey, runLibraryRead } from '@/app/organizations/[organizationId]/settings/connections/library-actions';
import type { LibraryApplication } from '@/lib/domain/integrations/app-library';

export function LibraryKeyForm({organizationId,application,connectionId}:{organizationId:string;application:string;connectionId?:string}) {
  const [state,action,pending]=useActionState(connectLibraryKey,{error:null});
  return <form action={action} className="mt-5 space-y-4">
    <input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="application" value={application}/>
    {connectionId?<input type="hidden" name="connectionId" value={connectionId}/>:null}
    <label className="block text-sm">Account label<TextInput name="label" className="mt-1 w-full" maxLength={200}/></label>
    <label className="block text-sm">API key<TextInput name="secret" type="password" required autoComplete="off" className="mt-1 w-full" maxLength={4000}/></label>
    <p className="text-sm text-muted">Use a key with only the read permissions needed. It is verified against the application and stored encrypted.</p>
    <Button type="submit" disabled={pending}>{pending?'Verifying…':'Verify and connect'}</Button><ErrorText role="alert">{state.error}</ErrorText>
  </form>;
}
export function LibraryReads({organizationId,connectionId,applications}:{organizationId:string;connectionId:string;applications:LibraryApplication[]}) {
  const actions=applications.flatMap(a=>a.actions);
  const [selected,setSelected]=useState(actions[0]?.capability??'');
  const [state,action,pending]=useActionState(runLibraryRead,{error:null,data:null});
  const operation=actions.find(a=>a.capability===selected);
  if(!actions.length)return null;
  return <section className="mt-8 max-w-3xl">
    <h2 className="font-medium">Read connected data</h2><p className="mt-1 text-sm text-muted">Requests use this account’s authorization and are recorded in execution history.</p>
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="connectionId" value={connectionId}/>
      <label className="block text-sm">Operation<select name="capability" value={selected} onChange={e=>setSelected(e.target.value)} className="mt-1 block w-full rounded border border-border bg-surface p-2">{actions.map(a=><option key={a.capability} value={a.capability}>{a.name}</option>)}</select></label>
      <div key={selected} className="space-y-3">{Object.entries(operation?.inputs.properties??{}).map(([key,rule])=><label key={key} className="block text-sm">{rule.description??key}
        {rule.type==='boolean'?<select name={`parameter:${key}`} defaultValue={String(rule.default??'')} className="mt-1 block rounded border border-border bg-surface p-2"><option value="">Default</option><option value="true">Yes</option><option value="false">No</option></select>:
        rule.type==='object'||rule.type==='array'?<textarea name={`parameter:${key}`} required={operation?.inputs.required.includes(key)} defaultValue={rule.default===undefined?'':JSON.stringify(rule.default)} placeholder={rule.type==='array'?'[]':'{}'} rows={3} className="mt-1 block w-full rounded border border-border bg-surface p-2"/>:
        <TextInput name={`parameter:${key}`} type={rule.type==='number'?'number':'text'} required={operation?.inputs.required.includes(key)} defaultValue={String(rule.default??'')} className="mt-1 w-full"/>}
      </label>)}</div>
      <p className="text-xs text-muted">{operation?.description}</p>
      <Button type="submit" disabled={pending}>{pending?'Reading…':'Read data'}</Button>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
    {state.data?<pre tabIndex={0} className="mt-4 max-h-96 overflow-auto rounded border border-border p-3 text-xs" aria-label="Connected data">{state.data}</pre>:null}
  </section>;
}
