import Link from 'next/link';
import { PageHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';

const sections = [['Overview', ''], ['Commercial', '/commercial'], ['Providers', '/providers'], ['Usage', '/usage'], ['Failures', '/failures']] as const;

export function TenantWorkspaceHeader({ id, name, currency }: { id: string; name: string; currency: string }) {
  const base = `/platform/organizations/${id}`;
  return <><nav aria-label="Breadcrumb" className="text-sm text-muted-foreground"><Link href="/platform/organizations" className="hover:underline">Organizations</Link> <span aria-hidden> / </span>{name}</nav><PageHeading className="mt-3">{name}</PageHeading><Hint className="mt-1 block">Tenant ID: {id} · Trades in {currency || 'an unconfigured currency'}.</Hint><nav aria-label="Tenant workspace" className="mt-5 flex gap-1 overflow-x-auto border-b border-border">{sections.map(([label, suffix]) => <Link key={label} href={`${base}${suffix}`} className="whitespace-nowrap border-b-2 border-transparent px-3 py-3 text-sm font-medium text-muted-foreground hover:border-foreground hover:text-foreground">{label}</Link>)}</nav></>;
}
