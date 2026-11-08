'use client';

import { useActionState, useId, useState, useTransition } from 'react';
import { Button, ButtonLink } from '@/components/controls/button';
import { FormField } from '@/components/controls/form';
import { ErrorText, TextArea, TextInput } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { relationshipAction, searchExistingClientTenants } from '@/app/organizations/[organizationId]/crm/contacts/[contactId]/service-actions';
import type { ClientTenantRelationship } from '@/lib/domain/customers/client-tenants';
import { SelectField } from '@/components/controls/select-field';

function EndRelationship({ organizationId, customerId, relationshipId }: { organizationId: string; customerId: string; relationshipId: string }) {
  const [state, action, pending] = useActionState(relationshipAction, { error: null, saved: false });
  return <details><summary className="cursor-pointer text-sm">Manage relationship</summary><form action={action} className="mt-3 space-y-3">
    <input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="customerId" value={customerId}/><input type="hidden" name="relationshipId" value={relationshipId}/><input type="hidden" name="operation" value="end"/>
    <p className="text-sm text-muted">Ending keeps the service history.</p>
    <ErrorText>{state.error}</ErrorText><Button type="submit" tone="secondary" disabled={pending}>{pending ? 'Ending…' : 'End relationship'}</Button>
  </form></details>;
}

export function ClientTenantSection({ organizationId, customerId, relationships, tenants, mayManage, mayLink, timezone = 'UTC' }: {
  organizationId: string; customerId: string; relationships: ClientTenantRelationship[];
  tenants: { id: string; name: string }[]; mayManage: boolean; mayLink: boolean;
  timezone?: string;
}) {
  const [state, action, pending] = useActionState(relationshipAction, { error: null, saved: false });
  const id = useId();
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<{ id: string; name: string }[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const tenantOptions = matches ?? tenants;
  return <Section><SectionHeading>Platform relationship</SectionHeading>
    {relationships.length ? <ul className="divide-y divide-border">{relationships.map(r => <li key={r.id} className="space-y-3 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">{r.tenant_name}</p><p className="text-sm text-muted">{r.status === 'ended' ? 'Relationship ended' : `Organization · ${r.operational_state === 'live' ? 'Live' : 'Setup'}`}</p></div>
      {r.may_open ? <ButtonLink tone="text" href={`/organizations/${r.tenant_organization_id}`}>Open organization</ButtonLink> : null}</div>
      <p className="text-sm text-muted">{r.origin === 'proposal_handoff' ? 'Linked through accepted proposal' : 'Linked by a business manager'} · {new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: timezone }).format(new Date(r.created_at))}</p>
      {mayManage && r.status === 'active' ? <EndRelationship organizationId={organizationId} customerId={customerId} relationshipId={r.id}/> : null}
    </li>)}</ul> : <p className="text-sm text-muted">No GildOps organization linked.</p>}
    {mayLink ? <details className="mt-4"><summary className="cursor-pointer text-sm font-medium">Link existing organization</summary>
      <form className="mt-4 flex max-w-lg flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); startSearch(async () => { try { setMatches(await searchExistingClientTenants(organizationId, customerId, search)); setSearchError(null); } catch { setSearchError('Organization search could not be loaded. Try again.'); } }); }}>
        <FormField id={`${id}-search`} label="Find organization">{props => <TextInput {...props} value={search} onChange={event => setSearch(event.target.value)} maxLength={100}/>}</FormField><Button type="submit" tone="secondary" disabled={searching}>{searching ? 'Searching…' : 'Search organizations'}</Button>
      </form><ErrorText role="alert">{searchError}</ErrorText><form action={action} className="mt-4 max-w-lg space-y-4">
      <input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="customerId" value={customerId}/><input type="hidden" name="operation" value="link"/>
      <FormField id={`${id}-tenant`} label="Organization">{props => <SelectField {...props} name="tenantId" required defaultValue="" options={[{ value: '', label: 'Select organization', disabled: true }, ...tenantOptions.filter(t => t.id !== organizationId).map((t) => ({ value: t.id, label: t.name }))]} />}</FormField>
      {tenantOptions.length >= 100 ? <p className="text-sm text-muted">Showing the newest matches. Search to refine.</p> : null}
      <FormField id={`${id}-basis`} label="Verified association basis" hint="Record the agreement you verified. This action also requires management permission in the receiving organization.">{props => <TextArea {...props} name="authorityBasis" required minLength={10} maxLength={460}/>}</FormField>
      <ErrorText role="alert">{state.error}</ErrorText>{state.saved ? <p role="status" className="text-sm">Organization linked.</p> : null}
      <Button type="submit" disabled={pending}>{pending ? 'Linking…' : 'Link organization'}</Button>
    </form></details> : null}
  </Section>;
}
