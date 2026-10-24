import Link from 'next/link';
import { Building2, User, CircleHelp } from 'lucide-react';
import { tabListStyles, tabTriggerStyles } from '@gold/ui/components/tab-styles';
import { ButtonLink } from '@/components/controls/button';
import { OperationalPanel, PanelState } from '@/components/operational/primitives';
import { AddContactsTrigger } from '@/features/crm/intake/contact-intake';
import { classificationLabel } from '@/lib/domain/customers/classification';
import type { RelationshipRow } from '@/lib/domain/contacts/relationship-activity';
import { groupRelationshipsByCompany, relationshipActivityLabel } from '@/lib/application/crm/dashboard';

const TYPE = { person: { label: 'Person', Icon: User }, company: { label: 'Company', Icon: Building2 }, unspecified: { label: 'Unspecified', Icon: CircleHelp } } as const;

function Row({row,base,timezone,showCompany}:{row:RelationshipRow;base:string;timezone:string;showCompany:boolean}) {
  const type=TYPE[row.contactType]??TYPE.unspecified; const date=row.activity?.occurredAt??row.createdAt;
  return <li className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_auto] sm:items-center sm:gap-3">
    <span className="flex min-w-0 items-start gap-2"><type.Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted"/><span className="min-w-0">
      <Link className="break-words font-medium hover:underline" href={`${base}/crm/contacts/${row.id}`}>{row.name}</Link>
      <span className="block text-xs text-muted">{type.label}{row.lifecycle?` · ${classificationLabel(row.lifecycle)}`:''}{showCompany&&row.companyName?` · ${row.companyName}`:''}</span></span></span>
    <span className="min-w-0 text-xs">{row.activity?relationshipActivityLabel(row.activity):<span className="text-muted">Added</span>}{row.nextTask?<span className="block text-muted">Next: {row.nextTask.title}</span>:null}</span>
    {date?<time className="text-xs tabular-nums text-muted sm:text-right" dateTime={date}>{new Intl.DateTimeFormat('en-CA',{timeZone:timezone,dateStyle:'medium'}).format(new Date(date))}</time>:null}
  </li>;
}

/**
 * The Dashboard's primary panel. Rows come from qualifying relationship events, newest first; when
 * none are recorded the panel says it is showing Recently added contacts instead. Grouping is a
 * URL-backed presentation of the same rows: company rows head their group and each person appears
 * once, under their primary active company, or under No company.
 */
export function RecentRelationships({organizationId,timezone,rows,mode,grouped,hrefFor,totalContacts,mayAddContacts}:{
  organizationId:string;timezone:string;rows:RelationshipRow[];mode:'active'|'added';grouped:boolean;
  /** Dashboard URL with the grouping choice applied, keeping the page's other parameters. */
  hrefFor:(group:boolean)=>string;totalContacts:number;mayAddContacts:boolean;
}) {
  const base=`/organizations/${organizationId}`;
  const title=mode==='active'?'Recently active relationships':'Recently added contacts';
  const toggle=rows.length?<nav aria-label="Relationship grouping" data-slot="tabs-list" data-variant="segmented" className={tabListStyles()}>
    {([[false,'All'],[true,'Group by company']] as const).map(([value,label])=><Link key={label} href={hrefFor(value)} scroll={false} aria-current={grouped===value?'true':undefined} data-state={grouped===value?'active':undefined} data-slot="tabs-trigger" className={tabTriggerStyles}>{label}</Link>)}
  </nav>:null;
  if(!totalContacts) return <OperationalPanel className="min-w-0" title={title}>
    <PanelState action={mayAddContacts?<AddContactsTrigger/>:undefined}>
      No contacts yet. People and companies you add appear here, ordered by their latest calls, completed tasks, lifecycle changes and opportunity progress.
    </PanelState>
  </OperationalPanel>;
  return <OperationalPanel className="min-w-0" title={title} action={toggle} body="edge-to-edge">
    {mode==='added'?<p className="border-b border-border px-4 py-2 text-xs text-muted">No calls, completed tasks, lifecycle changes or opportunity progress recorded yet, so these are the newest records.</p>:null}
    {grouped?<ul aria-label="Grouped by company">{groupRelationshipsByCompany(rows).map(group=><li key={group.companyId??'none'} className="border-b border-border last:border-b-0">
      <p className="bg-secondary/50 px-4 py-1.5 text-xs font-medium">{group.companyId?<Link className="hover:underline" href={`${base}/crm/contacts/${group.companyId}`}>{group.companyName}</Link>:'No company'}</p>
      <ul className="divide-y divide-border">{group.company?<Row row={group.company} base={base} timezone={timezone} showCompany={false}/>:null}{group.people.map(row=><Row key={row.id} row={row} base={base} timezone={timezone} showCompany={false}/>)}</ul>
    </li>)}</ul>
    :<ul className="divide-y divide-border">{rows.map(row=><Row key={row.id} row={row} base={base} timezone={timezone} showCompany/>)}</ul>}
    <div className="border-t border-border px-4 py-2 text-right"><ButtonLink tone="text" href={`${base}/crm/contacts`}>View all contacts</ButtonLink></div>
  </OperationalPanel>;
}
