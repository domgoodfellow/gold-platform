'use client';
import { useActionState, useState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, TextInput } from '@/components/controls/inputs';
import { connectLibraryKey, runLibraryRead } from '@/app/organizations/[organizationId]/settings/connections/library-actions';
import type { LibraryApplication } from '@/lib/domain/integrations/app-library';
import { SelectField } from '@/components/controls/select-field';

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
    <h2 className="font-medium">Read connected data</h2>
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="connectionId" value={connectionId}/>
      <label className="block text-sm">Operation<SelectField name="capability" value={selected} onValueChange={(next) => setSelected(next)} className='mt-1 block w-full' options={[...actions.map((a) => ({ value: a.capability, label: a.name }))]} /></label>
      <div key={selected} className="space-y-3">{Object.entries(operation?.inputs.properties??{}).map(([key,rule])=><label key={key} className="block text-sm">{rule.description??key}
        {rule.type==='boolean'?<SelectField name={`parameter:${key}`} defaultValue={String(rule.default??'')} className='mt-1 block' options={[{ value: '', label: 'Default' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />:
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
