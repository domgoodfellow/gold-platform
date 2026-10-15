import Link from 'next/link';
import { Button, ButtonLink } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import { BrandMark } from '@/components/display/brand-mark';
import { EmptyState, Section, SectionHeading } from '@/components/surfaces/section';
import { APP_CATEGORIES, APP_WORKSPACES, type LibraryEntry } from '@/lib/domain/integrations/app-library';

export function AppLibrary({ organizationId, entries, connected, mayManage, q, category, workspace, connectedOnly, page, total }: {
  organizationId: string; entries: LibraryEntry[]; connected: Map<string, { id: string; label: string }[]>; mayManage: boolean;
  q: string; category: string; workspace: string; connectedOnly: boolean; page: number; total: number;
}) {
  const base = `/organizations/${organizationId}/settings/connections`;
  const href = (nextPage: number) => `${base}?${new URLSearchParams({catalog:'open',q,category,workspace,page:String(nextPage),filter:connectedOnly?'connected':'all'})}#app-library`;
  return <Section id="app-library" className="mt-8 scroll-mt-20">
    <SectionHeading>App Library</SectionHeading>
    <form className="mt-3 flex flex-wrap items-end gap-3" method="get" action={`${base}#app-library`}>
      <input type="hidden" name="catalog" value="open" />
      <label className="w-full text-sm sm:min-w-56 sm:flex-1">Search applications<TextInput name="q" type="search" defaultValue={q} placeholder="Search apps or products" className="mt-1 w-full" /></label>
      <label className="w-full text-sm sm:w-auto">Category<select name="category" defaultValue={category} className="mt-1 block w-full rounded border border-border bg-surface p-2">
        <option value="">All categories</option>{APP_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></label>
      <label className="w-full text-sm sm:w-auto">Workspace<select name="workspace" defaultValue={workspace} className="mt-1 block w-full rounded border border-border bg-surface p-2">
        <option value="">All workspaces</option>{APP_WORKSPACES.map(w=><option key={w} value={w}>{w==='crm'?'CRM':w==='ai'?'AI':w[0].toUpperCase()+w.slice(1)}</option>)}</select></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="filter" value="connected" defaultChecked={connectedOnly} />Connected</label>
      <Button type="submit" tone="secondary" size="small">Search</Button>
    </form>
    <p className="mt-4 text-sm text-muted">{total} application {total===1?'family':'families'}. Connection setup and account authorization are separate from available operations.</p>
    {entries.length===0 ? <EmptyState className="mt-4">No application matches these filters.</EmptyState> : <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {entries.map(entry=><article key={entry.key} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4">
        <div className="flex items-center gap-3"><BrandMark label={entry.name} src={entry.icon} /><h3 className="font-medium">{entry.name}</h3></div>
        <p className="text-sm text-muted">{entry.description}</p>
        {entry.applications.length>1 ? <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted" aria-label="Products">{entry.applications.map(a=><li key={a.key}>{a.name}</li>)}</ul> : null}
        <p className="text-xs text-muted">{entry.categories.join(' · ')}</p>
        {entry.actionCount>0 ? <p className="text-sm">{entry.actionCount} reviewed read operations · permissions required</p> : null}
        {entry.categories.some(c=>c==='Payments'||c==='Accounting & Finance') ? <p className="text-xs text-muted">Connecting grants data access. Financial writes require separate authorization.</p> : null}
        {connected.get(entry.key)?.map(account=><Link key={account.id} href={`${base}/${account.id}`} className="text-sm underline">{account.label}</Link>)}
        <div className="mt-auto border-t border-border pt-3">
          {entry.blocker ? <p className="text-sm text-muted" role="status">{entry.blocker}</p> : mayManage ?
            <ButtonLink size="small" tone="primary" href={entry.authMethod==='api_key'
              ? `${base}/apps/${entry.applications[0]?.key ?? entry.key}` : `${base}/connect/${entry.key}`}>
              {connected.has(entry.key)?'Connect another account':'Connect'}</ButtonLink> : <Badge tone="neutral">Ask a connection administrator</Badge>}
        </div>
      </article>)}
    </div>}
    {total>24 ? <nav aria-label="Application pages" className="mt-5 flex gap-4">{page>0?<Link href={href(page-1)}>Previous</Link>:null}{(page+1)*24<total?<Link href={href(page+1)}>Next</Link>:null}</nav>:null}
  </Section>;
}
