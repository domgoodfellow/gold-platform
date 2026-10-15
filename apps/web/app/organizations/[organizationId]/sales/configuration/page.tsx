import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { FOCUS_RING, cx } from '@/components/class-names';
import { areaAvailable, areaHref } from '@/lib/navigation';
import { requireWorkspaceConfiguration } from '@/lib/route/workspace-configuration';

export default async function ConfigurationPage({ params }: PageProps<'/organizations/[organizationId]/sales/configuration'>) {
  const { organizationId } = await params;
  const { sections, gate } = await requireWorkspaceConfiguration(organizationId, 'crm');
  const mayOperate = areaAvailable('sales', { enabled: gate.enabledModules, ...gate });
  return <AppPage width="form">
    <PageHeader title="Configuration" crumbs={[{ label: 'CRM', href: mayOperate ? areaHref(organizationId, 'sales') : undefined }]} />
    <ul className="divide-y divide-border">
      {sections.map(section => <li key={section.key}>
        <Link href={section.href} className={cx(FOCUS_RING, 'flex min-h-11 items-center rounded-md px-2 py-3 text-sm hover:bg-hover')}>{section.label}</Link>
      </li>)}
    </ul>
  </AppPage>;
}
