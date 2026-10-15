'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireOrganization } from '@/lib/route/organization';
import { callDomainCommand, requireAccessToken } from '@/lib/api/client';
import { DomainError } from '@/lib/domain/errors';
import {importedApplications} from '@/lib/domain/integrations/app-library';
import { librarySourceHref } from '@/lib/route/library';

export async function connectLibraryKey(_state: {error:string|null}, form: FormData): Promise<{error:string|null}> {
  const org=String(form.get('organizationId')??'');
  const {db}=await requireOrganization(org);
  let id: string;
  try {
    const answer=await callDomainCommand<{connection_id:string}>('/integrations/operate',{token:await requireAccessToken(db),body:{
      operation:'library_connect_key',arguments:{organization_id:org,application:String(form.get('application')??''),
        secret:String(form.get('secret')??''),label:String(form.get('label')??''),connection_id:String(form.get('connectionId')??'')||undefined}}});
    id=answer.connection_id;
  } catch(e) {if(e instanceof DomainError)return {error:e.message};throw e;}
  revalidatePath(`/organizations/${org}/settings/connections`);
  redirect(`/organizations/${org}/settings/connections/${id}?connected=1`);
}
export async function runLibraryRead(_state:{error:string|null;data:string|null},form:FormData):Promise<{error:string|null;data:string|null}> {
  const org=String(form.get('organizationId')??'');
  const {db}=await requireOrganization(org);
  try {
    const capability=String(form.get('capability')??'');
    const operation=importedApplications.flatMap(app=>app.actions).find(a=>a.capability===capability);
    if(!operation)return {error:'This operation is unavailable.',data:null};
    const params:Record<string,unknown>={};
    for(const [key,rule] of Object.entries(operation.inputs.properties)) {
      const value=String(form.get(`parameter:${key}`)??'');
      if(!value&& !operation.inputs.required.includes(key))continue;
      params[key]=rule.type==='number'?Number(value):rule.type==='boolean'?value==='true':
        rule.type==='array'||rule.type==='object'?JSON.parse(value):value;
    }
    const answer=await callDomainCommand<{data:unknown}>('/integrations/operate',{token:await requireAccessToken(db),timeoutMs:60000,
      body:{operation:'invoke',arguments:{connection_id:String(form.get('connectionId')??''),capability,params}}});
    return {error:null,data:JSON.stringify(answer.data,null,2)};
  }catch(e){if(e instanceof DomainError)return {error:e.message,data:null};if(e instanceof SyntaxError)return {error:'Enter valid JSON parameters.',data:null};throw e;}
}

export async function syncLibraryResource(_state:{error:string|null;message:string|null},form:FormData):Promise<{error:string|null;message:string|null}> {
  const org=String(form.get('organizationId')??'');
  const {db}=await requireOrganization(org);
  const resourceId=String(form.get('resourceId')??'');
  const parameters:Record<string,string|number>={};
  for(const key of ['range','worksheet','start','end']) {
    const value=String(form.get(key)??'').trim();
    if(value)parameters[key]=value;
  }
  if(form.has('key_column'))parameters.key_column=Number(form.get('key_column'));
  try {
    const answer=await callDomainCommand<{error?:string;complete?:boolean;message?:string}>('/integrations/operate',{
      token:await requireAccessToken(db),timeoutMs:60000,body:{operation:'resource_sync',arguments:{
        resource_id:resourceId,configure:true,enabled:form.get('intent')!=='disable',parameters}}});
    revalidatePath(librarySourceHref(org, resourceId));
    return {error:answer.error??null,message:answer.error?null:answer.message??(answer.complete?'Synchronization completed.':'Next page is scheduled for synchronization.')};
  }catch(error){if(error instanceof DomainError)return {error:error.message,message:null};throw error;}
}
