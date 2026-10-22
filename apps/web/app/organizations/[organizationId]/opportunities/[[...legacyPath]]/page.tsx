import {redirect} from 'next/navigation';
/** Temporary compatibility redirect. Retirement criteria: docs/data.md. */
export default async function LegacyCrmPage({params,searchParams}:{params:Promise<{organizationId:string;legacyPath?:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const {organizationId,legacyPath=[]}=await params;
 const query=new URLSearchParams();
 for(const [key,value] of Object.entries(await searchParams)) for(const item of Array.isArray(value)?value:value===undefined?[]:[value]) query.append(key,item);
 let suffix=legacyPath.map(encodeURIComponent).join('/');
 let target='crm/opportunities';
 if(suffix==='pipeline'){target='crm/pipeline';suffix='';}
 redirect(`/organizations/${encodeURIComponent(organizationId)}/${target}${suffix?`/${suffix}`:''}${query.size?`?${query}`:''}`);
}
