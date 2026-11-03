'use client';
import {useActionState,useId} from 'react';
import {Button} from '@/components/controls/button';
import {FormField,FormError} from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import {saveAffiliationAction} from '@/app/organizations/[organizationId]/crm/contacts/[contactId]/actions';
import { SelectField } from '@/components/controls/select-field';
export function AffiliationForm({organizationId,personId,companyId,options=[],title='',active=true,primary=false}:{organizationId:string;personId?:string;companyId?:string;options?:{id:string;name:string}[];title?:string;active?:boolean;primary?:boolean}) {
 const id=useId();const [state,action,pending]=useActionState(saveAffiliationAction,{error:null});
 return <form action={action} className="mt-2 flex flex-wrap items-end gap-3"><input type="hidden" name="organizationId" value={organizationId}/>
 {personId?<input type="hidden" name="personId" value={personId}/>:null}{companyId?<input type="hidden" name="companyId" value={companyId}/>:null}
 {(!personId || !companyId)?<FormField id={`${id}-contact`} label={personId?'Company':'Person'}>{field=><SelectField {...field} name={personId?'companyId':'personId'} required defaultValue="" options={[{ value: '', label: 'Choose a contact', disabled: true }, ...options.map((option) => ({ value: option.id, label: option.name }))]} />}</FormField>:null}
 <FormField id={`${id}-title`} label="Role or title" optional>{field=><TextInput {...field} name="title" defaultValue={title} maxLength={200}/>}</FormField>
 <label className="text-sm"><input type="checkbox" name="active" defaultChecked={active}/> Active</label><label className="text-sm"><input type="checkbox" name="isPrimary" defaultChecked={primary}/> Primary</label>
 <Button type="submit" tone="secondary" disabled={pending}>Save affiliation</Button><FormError>{state.error}</FormError></form>;
}
