'use client';

import { useActionState, useState, useEffect, useRef } from 'react';
import { Button, ButtonLink } from '@/components/controls/button';
import { ErrorText, TextArea, TextInput, SelectInput } from '@/components/controls/inputs';
import { PageDrawer, PageDrawerContent, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/panels/page-drawer';
import { EditorLayout } from '@/features/studio/editor-layout';
import { portalAction, readPortalHistory } from '@/app/organizations/[organizationId]/studio/portal/actions';
import { DEFAULT_PORTAL_CONTENT, PORTAL_MODULES, PORTAL_TEMPLATES, portalFromTemplate, newPortalModule, removePortalPage, parsePortalContent, type PortalContent, type PortalModule } from '@/lib/domain/portal/composition';
import type { PortalDefinition, PortalRevision, PortalAvailability } from '@/lib/domain/portal/definitions';
import { PortalRenderer, PORTAL_PREVIEW_RECORDS } from './portal-renderer';
import { useUnsavedChanges } from '@/components/controls/use-unsaved-changes';
import type { Brand } from '@/lib/domain/branding/brand';
import type { PublicProfile } from '@/lib/domain/tenancy/profile';
import { BrandStyle } from '@/features/branding/brand-style';
import { PublicHeader } from '@/features/public-profile/public-header';

type EditorSelection = { pageId?:string; moduleId:string|null; selection:'settings'|'page'|'instance' };
type Props = { organizationId: string; timezone: string; enabled: boolean; definition: PortalDefinition|null; history: PortalRevision[]; availability: PortalAvailability; brand: Brand; profile: PublicProfile; logo: string|null; initialTemplate?: string };
export function PortalWorkbench(props: Props) {
  const [state,action,pending] = useActionState(portalAction,{error:null});
  const [historyOpen,setHistoryOpen] = useState(false);
  const [selected,setSelected] = useState<EditorSelection>({moduleId:null,selection:'settings'});
  const root=useRef<HTMLDivElement>(null);
  const previousVersion=useRef(props.definition?.draft_version ?? 0);
  useEffect(()=>{
    const version=props.definition?.draft_version ?? 0;
    if(version!==previousVersion.current && document.activeElement===document.body) root.current?.querySelector<HTMLElement>('button[data-portal-action]:not(:disabled)')?.focus();
    previousVersion.current=version;
  },[props.definition?.draft_version]);
  return <div ref={root} className="@container/editor space-y-4"><ErrorText role="alert">{state.error}</ErrorText>{state.success ? <p role="status">{state.success}</p> : null}<PortalEditor key={props.definition?.draft_version ?? 0} {...props} action={action} pending={pending} historyOpen={historyOpen} onHistoryOpenChange={setHistoryOpen} selected={selected} onSelectionChange={setSelected}/></div>;
}
function PortalEditor({ organizationId, timezone, definition, history, availability, brand, profile, logo, initialTemplate, action, pending, historyOpen, onHistoryOpenChange, selected, onSelectionChange }: Props & { action: (form:FormData)=>void; pending:boolean;historyOpen:boolean;onHistoryOpenChange:(open:boolean)=>void;selected:EditorSelection;onSelectionChange:(next:EditorSelection)=>void }) {
  const initial = definition ? parsePortalContent(definition.draft_content) : initialTemplate && PORTAL_TEMPLATES.some(item => item.key === initialTemplate) ? portalFromTemplate(initialTemplate) : structuredClone(DEFAULT_PORTAL_CONTENT);
  const [content,setContent] = useState<PortalContent>(initial);
  const pageId = selected.pageId ?? initial.defaultPageId;
  const moduleId = selected.moduleId;
  const setModuleId=(moduleId:string|null)=>onSelectionChange({...selected,moduleId});
  const selection = selected.selection;
  const [historical,setHistorical] = useState<PortalRevision|null>(null);
  const [validation,setValidation] = useState<string|null>(null);
  const [olderHistory,setOlderHistory]=useState<PortalRevision[]>([]);
  const [historyPending,setHistoryPending]=useState(false);
  const [historyError,setHistoryError]=useState<string|null>(null);
  const [moreHistory,setMoreHistory]=useState(history.length===50);
  const revisions=[...history,...olderHistory];
  async function loadHistory() {
    const before=revisions.at(-1)?.number;
    if(!before)return;
    setHistoryPending(true);setHistoryError(null);
    try {const older=await readPortalHistory(organizationId,before);setOlderHistory([...olderHistory,...older]);setMoreHistory(older.length===50);}
    catch {setHistoryError('Older revisions could not be loaded. Try again.');}
    finally {setHistoryPending(false);}
  }
  const page = content.pages.find(item=>item.id===pageId) ?? content.pages[0];
  const instance = page.modules.find(item=>item.id===moduleId);
  const dirty = JSON.stringify(content)!==JSON.stringify(initial);
  useUnsavedChanges(dirty);
  const context = <><input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="version" value={definition?.draft_version ?? 0}/></>;
  const published = history.find(item=>item.id===definition?.published_revision_id);
  const valid = (()=>{try {parsePortalContent(content);return true;} catch {return false;}})();
  function updatePage(patch:Partial<typeof page>) {setContent({...content,pages:content.pages.map(item=>item.id===page.id ? {...item,...patch} : item)});}
  function reorder<T>(items:T[],index:number,direction:number) {const result=[...items];const target=index+direction;if(target<0||target>=items.length)return items;[result[index],result[target]]=[result[target],result[index]];return result;}
  function selectPage(id:string) {onSelectionChange({pageId:id,moduleId:null,selection:'page'});}
  function addModule(kind:PortalModule) {const item=newPortalModule(kind);updatePage({modules:[...page.modules,item]});onSelectionChange({...selected,moduleId:item.id,selection:'instance'});}
  const structure = <div className="space-y-3">
    <Button type="button" tone="text" onClick={()=>{onSelectionChange({...selected,moduleId:null,selection:'settings'});}}>Portal settings</Button>
    <h3 className="text-sm font-semibold">Pages & navigation</h3>
    <ol className="space-y-2">{content.pages.map((item,index)=><li key={item.id} className="rounded-md border border-border p-2">
      <Button type="button" tone="text" aria-pressed={page.id===item.id} onClick={()=>selectPage(item.id)}>{item.name}</Button>
      <p className="text-xs text-muted">{item.id===content.defaultPageId ? 'Default page' : content.navigation.some(entry=>entry.pageId===item.id) ? 'In navigation' : 'Excluded from customer access'}</p>
      <div className="flex flex-wrap gap-1"><Button type="button" size="small" tone="text" aria-label={`Move page ${item.name} up`} disabled={!index} onClick={()=>setContent({...content,pages:reorder(content.pages,index,-1)})}>Up</Button><Button type="button" size="small" tone="text" aria-label={`Move page ${item.name} down`} disabled={index===content.pages.length-1} onClick={()=>setContent({...content,pages:reorder(content.pages,index,1)})}>Down</Button></div>
    </li>)}</ol>
    <Button type="button" tone="secondary" disabled={content.pages.length>=12} onClick={()=>{const id=crypto.randomUUID();let number=content.pages.length+1;while(content.pages.some(item=>item.path===`page-${number}`))number++;const name=`Page ${number}`;setContent({...content,pages:[...content.pages,{id,name,path:`page-${number}`,modules:[newPortalModule('work')]}],navigation:[...content.navigation,{pageId:id,label:name}]});selectPage(id);}}>Add page</Button>
    <h3 className="text-sm font-semibold">Modules on {page.name}</h3>
    <ol className="space-y-2">{page.modules.map((item,index)=><li key={item.id} className="rounded-md border border-border p-2"><Button type="button" tone="text" aria-pressed={moduleId===item.id} onClick={()=>{onSelectionChange({...selected,moduleId:item.id,selection:'instance'});}}>{item.config.heading}</Button><div className="flex flex-wrap gap-1"><Button type="button" size="small" tone="text" aria-label={`Move ${item.config.heading} up`} disabled={!index} onClick={()=>updatePage({modules:reorder(page.modules,index,-1)})}>Up</Button><Button type="button" size="small" tone="text" aria-label={`Move ${item.config.heading} down`} disabled={index===page.modules.length-1} onClick={()=>updatePage({modules:reorder(page.modules,index,1)})}>Down</Button></div></li>)}</ol>
    {(Object.keys(PORTAL_MODULES) as PortalModule[]).map(kind=><div key={kind}><Button type="button" tone="secondary" size="small" disabled={page.modules.length>=12 || (!PORTAL_MODULES[kind].multiple && page.modules.some(item=>item.kind===kind))} onClick={()=>addModule(kind)}>Add {PORTAL_MODULES[kind].label}</Button>{!availability[kind] ? <p className="text-xs text-muted">Unavailable with current entitlement or activation.</p> : null}</div>)}
  </div>;
  const inspector = <div className="space-y-4">
    {selection==='settings' ? <><label className="block text-sm">Portal title<TextInput value={content.settings.title} maxLength={100} onChange={event=>setContent({...content,settings:{...content.settings,title:event.target.value}})}/></label><label className="block text-sm">Introduction<TextArea value={content.settings.introduction} maxLength={1000} onChange={event=>setContent({...content,settings:{...content.settings,introduction:event.target.value}})}/></label><label className="block text-sm">Spacing<SelectInput value={content.settings.layout} onChange={event=>setContent({...content,settings:{...content.settings,layout:event.target.value as 'comfortable'|'compact'}})}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></SelectInput></label><ButtonLink href={`/organizations/${organizationId}/settings/branding`} tone="text">Edit canonical branding</ButtonLink>
      {!definition ? <label className="block text-sm">Starting template<SelectInput value="" onChange={event=>{const next=portalFromTemplate(event.target.value);setContent(next);selectPage(next.defaultPageId);}}><option value="" disabled>Choose a starting point</option>{PORTAL_TEMPLATES.map(item=><option key={item.key} value={item.key}>{item.name}</option>)}</SelectInput></label> : null}</>
    : selection==='page' ? <><label className="block text-sm">Page name<TextInput value={page.name} maxLength={80} onChange={event=>updatePage({name:event.target.value})}/></label><label className="block text-sm">Page path<TextInput value={page.path} maxLength={64} onChange={event=>updatePage({path:event.target.value})}/></label><p className="text-xs text-muted">Lowercase words separated by hyphens. Each path must be unique.</p>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={content.navigation.some(item=>item.pageId===page.id)} disabled={page.id===content.defaultPageId} onChange={event=>setContent({...content,navigation:event.target.checked ? [...content.navigation,{pageId:page.id,label:page.name}] : content.navigation.filter(item=>item.pageId!==page.id)})}/>Include in customer navigation</label>
      {content.navigation.some(item=>item.pageId===page.id) ? <><label className="block text-sm">Navigation label<TextInput value={content.navigation.find(item=>item.pageId===page.id)!.label} maxLength={80} onChange={event=>setContent({...content,navigation:content.navigation.map(item=>item.pageId===page.id ? {...item,label:event.target.value} : item)})}/></label><div className="flex gap-2">{[-1,1].map(direction=><Button key={direction} type="button" size="small" tone="secondary" disabled={content.navigation.findIndex(item=>item.pageId===page.id)+direction<0 || content.navigation.findIndex(item=>item.pageId===page.id)+direction>=content.navigation.length} onClick={()=>setContent({...content,navigation:reorder(content.navigation,content.navigation.findIndex(item=>item.pageId===page.id),direction)})}>{direction===-1 ? 'Navigation up' : 'Navigation down'}</Button>)}</div><Button type="button" tone="secondary" disabled={page.id===content.defaultPageId} onClick={()=>setContent({...content,defaultPageId:page.id})}>Make default page</Button></> : null}
      <Button type="button" tone="danger" disabled={content.pages.length===1} onClick={()=>{const next=removePortalPage(content,page.id);setContent(next);selectPage(next.defaultPageId);}}>Delete page</Button></>
    : instance ? <><p className="font-medium">{PORTAL_MODULES[instance.kind].label}</p><p className="text-xs text-muted">{PORTAL_MODULES[instance.kind].access}</p><label className="block text-sm">Module heading<TextInput value={instance.config.heading} maxLength={100} onChange={event=>updatePage({modules:page.modules.map(item=>item.id===instance.id ? {...item,config:{...item.config,heading:event.target.value}} : item)})}/></label><label className="block text-sm">Presentation<SelectInput value={instance.config.variant} onChange={event=>updatePage({modules:page.modules.map(item=>item.id===instance.id ? {...item,config:{...item.config,variant:event.target.value}} : item)})}>{PORTAL_MODULES[instance.kind].variants.map(variant=><option key={variant} value={variant}>{variant}</option>)}</SelectInput></label><label className="block text-sm">Record limit<TextInput type="number" min={1} max={100} value={instance.config.limit} onChange={event=>updatePage({modules:page.modules.map(item=>item.id===instance.id ? {...item,config:{...item.config,limit:Number(event.target.value)}} : item)})}/></label>
      {instance.kind==='invoices' ? <label className="flex gap-2 text-sm"><input type="checkbox" checked={instance.config.payments} onChange={event=>updatePage({modules:page.modules.map(item=>item.id===instance.id ? {...item,config:{...item.config,payments:event.target.checked}} : item)})}/>Offer payments when Finance permits</label> : null}
      {PORTAL_MODULES[instance.kind].multiple ? <Button type="button" tone="secondary" disabled={page.modules.length>=12} onClick={()=>{const copy={...structuredClone(instance),id:crypto.randomUUID()};updatePage({modules:[...page.modules,copy]});setModuleId(copy.id);}}>Duplicate module</Button> : null}
      <Button type="button" tone="danger" disabled={page.modules.length===1} onClick={()=>{updatePage({modules:page.modules.filter(item=>item.id!==instance.id)});onSelectionChange({...selected,moduleId:null,selection:'page'});}}>Remove module</Button></> : null}
  </div>;
  const canvas = <div data-brand><BrandStyle brand={brand}/><PortalRenderer content={content} page={page} records={PORTAL_PREVIEW_RECORDS} available={availability} preview onSelect={selectPage} header={<PublicHeader profile={profile} logoUrl={logo}/>}/></div>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">{published ? `Published · Revision ${published.number}` : definition?.revision_number ? 'Unpublished' : 'Default portal in use'}</p><p className="text-sm text-muted">{dirty ? 'Unsaved changes' : definition?.draft_status==='in_review' ? 'In review — saved draft ready to publish' : definition ? 'Draft saved' : 'Create your Portal draft'}</p></div>
      <div className="flex flex-wrap gap-2">{(['Structure','Inspector'] as const).map(label=><PageDrawer key={label}><PageDrawerTrigger asChild><Button type="button" tone="secondary" className="@min-[56rem]/editor:hidden">{label}</Button></PageDrawerTrigger><PageDrawerContent><PageDrawerHeader><PageDrawerTitle>{label}</PageDrawerTitle></PageDrawerHeader><div className="min-h-0 flex-1 overflow-y-auto">{label==='Structure' ? structure : inspector}</div></PageDrawerContent></PageDrawer>)}
        <PageDrawer><PageDrawerTrigger asChild><Button type="button" tone="secondary">Preview</Button></PageDrawerTrigger><PageDrawerContent><PageDrawerHeader><PageDrawerTitle>Portal preview</PageDrawerTitle></PageDrawerHeader><div className="min-h-0 flex-1 overflow-y-auto">{canvas}</div></PageDrawerContent></PageDrawer>
        <form action={action} onSubmit={event=>{if(!valid){event.preventDefault();setValidation('Check page paths, navigation and module configuration before saving.');}}}>{context}<input type="hidden" name="operation" value="save"/><input type="hidden" name="content" value={JSON.stringify(content)}/><Button data-portal-action disabled={pending||!valid||(!dirty&&!!definition)}>{definition ? 'Save draft' : 'Create Portal'}</Button></form>
        <form action={action}>{context}<input type="hidden" name="operation" value="review"/><Button data-portal-action tone="secondary" disabled={pending||dirty||!definition||definition.draft_status==='in_review'}>Send for review</Button></form>
        <form action={action}>{context}<input type="hidden" name="operation" value="publish"/><Button data-portal-action disabled={pending||dirty||!definition||definition.draft_status!=='in_review'||!availability.publish}>Publish portal</Button></form>
      </div>
    </div>
    {!availability.publish ? <p className="text-sm text-muted">Publishing requires current Portal entitlement and activation. <ButtonLink tone="text" href={`/organizations/${organizationId}/studio/configuration`}>Configure Studio</ButtonLink></p> : null}
    {!definition?.revision_number ? <p className="text-sm text-muted">Existing invitations keep the default Portal until your first custom publication.</p> : null}
    <ErrorText role="alert">{validation ?? (!valid ? 'Check unique page paths, required text, navigation and module configuration.' : null)}</ErrorText>
    <EditorLayout structure={structure} inspector={inspector}>{canvas}</EditorLayout>
    <details open={historyOpen} onToggle={event=>onHistoryOpenChange(event.currentTarget.open)} className="rounded-lg border border-border p-4"><summary className="cursor-pointer font-medium">Publishing history & access</summary><div className="mt-4 space-y-4"><ButtonLink tone="text" href={`/organizations/${organizationId}/crm/contacts`}>Manage customer invitations</ButtonLink>{published ? <form action={action}>{context}<input type="hidden" name="operation" value="unpublish"/><Button tone="danger" disabled={pending||dirty}>Unpublish portal</Button><p className="text-sm text-muted">Customer access pauses; invitations and records remain.</p></form> : null}
      {revisions.length ? <ol className="divide-y divide-border">{revisions.map(revision=><li key={revision.id} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span>Revision {revision.number} · {new Intl.DateTimeFormat('en-CA',{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(revision.published_at))}{revision.id===published?.id ? ' · Live' : ''}</span><Button type="button" size="small" tone="secondary" onClick={()=>setHistorical(revision)}>Inspect revision {revision.number}</Button><form action={action}>{context}<input type="hidden" name="operation" value="restore"/><input type="hidden" name="revisionId" value={revision.id}/><Button size="small" tone="secondary" disabled={pending||dirty}>Restore revision {revision.number} to draft</Button></form></li>)}</ol> : <p className="text-sm text-muted">No published revisions yet.</p>}
      <ErrorText role="alert">{historyError}</ErrorText>{moreHistory ? <Button type="button" tone="secondary" disabled={historyPending} onClick={loadHistory}>{historyPending ? 'Loading history...' : 'Load older revisions'}</Button> : null}
    </div></details>
    <PageDrawer open={!!historical} onOpenChange={open=>{if(!open)setHistorical(null);}}><PageDrawerContent><PageDrawerHeader><PageDrawerTitle>Historical Portal revision {historical?.number}</PageDrawerTitle></PageDrawerHeader><div className="min-h-0 flex-1 overflow-y-auto">{historical ? <HistoricalPreview revision={historical} brand={brand} profile={profile} logo={logo}/> : null}</div></PageDrawerContent></PageDrawer>
  </div>;
}
function HistoricalPreview({revision,brand,profile,logo}:{revision:PortalRevision;brand:Brand;profile:PublicProfile;logo:string|null}) {
  const content=parsePortalContent(revision.content);const [id,setId]=useState(content.defaultPageId);
  return <div data-brand><BrandStyle brand={brand}/><PortalRenderer content={content} page={content.pages.find(item=>item.id===id)!} records={PORTAL_PREVIEW_RECORDS} preview onSelect={setId} header={<PublicHeader profile={profile} logoUrl={logo}/>}/></div>;
}
